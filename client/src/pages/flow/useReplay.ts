import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { isShortcutBlocked, isSlider } from '@client/lib/keys.js';

/** The whole replay takes this long, whatever the length of the run. */
const REPLAY_SECONDS = 40;

/** Replay holds on each chapter for this many 100 ms ticks, so the narration can be read. */
const CHAPTER_HOLD_TICKS = 30;

interface Span {
  start: number;
  end: number;
}

interface ClockCtx {
  range: Span | null;
  chapters: readonly { at: number }[];
  /** A new machine or rig starts again at its end. */
  machineId: string | null;
  rig: string | null | undefined;
}

export interface StepKeys {
  prev: () => void;
  next: () => void;
}

/** One 100 ms tick: the next time, whether a chapter was landed on, and whether the run is over. */
function advance(cur: number, range: Span, chapters: ClockCtx['chapters']) {
  const next = cur + (range.end - range.start) / (REPLAY_SECONDS * 10);
  const chapter = chapters.find((c) => c.at > cur && c.at <= next);
  const to = chapter ? chapter.at : next;

  return { to: Math.min(to, range.end), landed: !!chapter, done: to >= range.end };
}

/** Nothing moves under the cursor: after a replay move the window is put back where it was. */
function useKeepScroll() {
  const keepScroll = useRef<number | null>(null);

  useEffect(() => {
    const y = keepScroll.current;

    keepScroll.current = null;
    if (y !== null && window.scrollY !== y) {
      window.scrollTo({ top: y });
    }
  });

  return keepScroll;
}

interface Clock {
  at: number | null;
  playing: boolean;
  setPlaying: Dispatch<SetStateAction<boolean>>;
  stepId: string | null;
  jump: (t: number | null, step?: string | null) => void;
  hold: MutableRefObject<number>;
  atRef: MutableRefObject<number | null>;
}

/** The clock's own state, and `jump`, the one way to move it (it also keeps the window still). */
function useClockState(): Clock {
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  // Set while stepping one handoff at a time; any other move clears it.
  const [stepId, setStepId] = useState<string | null>(null);
  const atRef = useRef<number | null>(null);
  const hold = useRef(0);
  const keepScroll = useKeepScroll();
  const jump = (t: number | null, step: string | null = null) => {
    keepScroll.current = window.scrollY;
    atRef.current = t;
    setAt(t);
    setStepId(step);
  };

  return { at, playing, setPlaying, stepId, jump, hold, atRef };
}

/**
 * A tick every 100 ms moves the clock on and holds on each chapter. `jump` is left out of the
 * inputs on purpose, so the interval is not restarted on every tick.
 */
function useTicker(
  { playing, setPlaying, jump, hold, atRef }: Clock,
  ctx: Pick<ClockCtx, 'range' | 'chapters'>
) {
  const { range, chapters } = ctx;

  useEffect(() => {
    if (!playing || !range) {
      return;
    }

    const id = window.setInterval(() => {
      if (hold.current > 0) {
        hold.current -= 1;

        return;
      }

      const tick = advance(atRef.current ?? range.start, range, chapters);

      if (tick.landed) {
        hold.current = CHAPTER_HOLD_TICKS;
      }

      if (tick.done) {
        setPlaying(false);
      }

      jump(tick.to);
    }, 100);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jump, hold, atRef: see above
  }, [playing, range, chapters]);
}

/** The replay clock: `at` (null = the end, the current state), whether it plays, the stepped handoff. */
export function useReplayClock(ctx: ClockCtx) {
  const clock = useClockState();
  const { jump, setPlaying } = clock;

  // A new rig starts at its end (the current state).
  useEffect(() => {
    jump(null);
    setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the machine or rig changes
  }, [ctx.machineId, ctx.rig]);
  useTicker(clock, ctx);

  return clock;
}

/** An arrow press that is meant for the page: not with a modifier, not in a text box or on a slider. */
function isStepPress(e: KeyboardEvent) {
  const arrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight';

  return arrow && !isShortcutBlocked(e) && !isSlider(e.target);
}

/** ← → press the step buttons. The page fills `ref.current` with the latest step functions. */
export function useStepKeys(keys: boolean): MutableRefObject<StepKeys | null> {
  const stepKeys = useRef<StepKeys | null>(null);

  useEffect(() => {
    if (!keys) {
      return;
    }

    const onKey = (e: KeyboardEvent) => {
      const step = stepKeys.current;

      if (!step || !isStepPress(e)) {
        return;
      }

      e.preventDefault();
      if (e.key === 'ArrowLeft') {
        step.prev();
      } else {
        step.next();
      }
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [keys]);

  return stepKeys;
}
