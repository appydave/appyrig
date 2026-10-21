import { Fragment, useMemo, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '../lib/markdown.js';
import YamlView from './YamlView.js';

const inline = (nodes: Inline[]): ReactNode =>
  nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={i}>{n.text}</Fragment>;
      case 'code':
        return <code key={i}>{n.text}</code>;
      case 'strong':
        return <strong key={i}>{inline(n.children)}</strong>;
      case 'em':
        return <em key={i}>{inline(n.children)}</em>;
      case 'link':
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
            {inline(n.children)}
          </a>
        );
    }
  });

function blocks(list: Block[]): ReactNode {
  return list.map((b, i) => {
    switch (b.t) {
      case 'front':
        return (
          <details key={i} className="md-front" data-testid="md-front">
            <summary>Front matter</summary>
            <YamlView source={b.text} plain />
          </details>
        );
      case 'heading': {
        const H = `h${Math.min(6, b.level)}` as 'h1';

        return <H key={i}>{inline(b.inline)}</H>;
      }

      case 'para':
        return <p key={i}>{inline(b.inline)}</p>;
      case 'code':
        return /^ya?ml$/i.test(b.lang) ? (
          <YamlView key={i} source={b.text} plain />
        ) : (
          <pre key={i} className="md-code" data-lang={b.lang || undefined}>
            <code>{b.text}</code>
          </pre>
        );
      case 'list': {
        const L = b.ordered ? 'ol' : 'ul';

        return (
          <L key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                {inline(it.inline)}
                {it.children.length > 0 && blocks(it.children)}
              </li>
            ))}
          </L>
        );
      }

      case 'quote':
        return <blockquote key={i}>{blocks(b.children)}</blockquote>;
      case 'hr':
        return <hr key={i} />;
      case 'table':
        return (
          <div key={i} className="md-table-wrap">
            <table>
              <thead>
                <tr>
                  {b.head.map((h, j) => (
                    <th key={j} style={{ textAlign: b.align[j] ?? undefined }}>
                      {inline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) => (
                      <td key={k} style={{ textAlign: b.align[k] ?? undefined }}>
                        {inline(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

/** S7-ui: Markdown rendered as React elements (headings, tables, code, lists), never as raw HTML. */
export default function MarkdownView({ source }: { source: string }) {
  const tree = useMemo(() => parseMarkdown(source), [source]);

  return (
    <div className="md" data-testid="markdown-view">
      {blocks(tree)}
    </div>
  );
}
