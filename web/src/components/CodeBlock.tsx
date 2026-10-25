import { Copy } from './Copy.tsx';

export function CodeBlock({ code, label = 'Copy' }: { code: string; label?: string }) {
  return (
    <div className="code-block">
      <pre className="code" tabIndex={0} aria-label="Code example">
        <code>{code}</code>
      </pre>
      <Copy text={code} label={label} className="copy" />
    </div>
  );
}
