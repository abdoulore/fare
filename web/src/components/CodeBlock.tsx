import { Copy } from './Copy.tsx';

export function CodeBlock({ code, title, label = 'Copy' }: { code: string; title: string; label?: string }) {
  return (
    <div className="code-block">
      <div className="code-bar">
        <span>{title}</span>
        <Copy text={code} label={label} className="copy" />
      </div>
      <pre className="code" tabIndex={0} aria-label={`Code example: ${title}`}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
