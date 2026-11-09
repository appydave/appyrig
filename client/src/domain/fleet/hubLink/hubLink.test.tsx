import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AUTH_ERRORS } from '@appydave/shared';
import { useFleet } from '@client/domain/fleet/useFleet.js';
import { socketWithEvents } from '@client/test/socketWithEvents.js';

/** What the fleet strip is told about the hub: it must never say live when the hub has gone. */

function linked(connected: boolean) {
  const spy = socketWithEvents();

  spy.raw.connected = connected;

  const getSocket = () => spy.socket;
  const { result } = renderHook(() => useFleet(getSocket));

  return { fire: spy.fire, link: () => result.current.link };
}

describe('Feature: the link to the hub', () => {
  it('Scenario: given a socket not yet connected, then the link is connecting', () => {
    expect(linked(false).link()).toBe('connecting');
  });

  it('Scenario: given a socket already connected, then the link is connected', () => {
    expect(linked(true).link()).toBe('connected');
  });

  it('Scenario: given a connected fleet, when the socket disconnects, then the link is disconnected', () => {
    const { fire, link } = linked(true);

    fire('disconnect', 'transport close');

    expect(link()).toBe('disconnected');
  });

  it('Scenario: given a lost link, when the socket connects again, then the link is connected', () => {
    const { fire, link } = linked(false);

    fire('disconnect', 'transport close');
    fire('connect');

    expect(link()).toBe('connected');
  });

  it('Scenario: given the hub refuses the browser session, then the link is unauthorised', () => {
    const { fire, link } = linked(true);

    fire('connect_error', new Error(AUTH_ERRORS.browserSession));

    expect(link()).toBe('unauthorised');
  });

  it('Scenario: given any other connection error, then the link is disconnected', () => {
    const { fire, link } = linked(true);

    fire('connect_error', new Error('xhr poll error'));

    expect(link()).toBe('disconnected');
  });
});
