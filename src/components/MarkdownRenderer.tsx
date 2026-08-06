import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  children?: string;
}

export const MarkdownRenderer = ({ children = '' }: MarkdownRendererProps) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        strong: ({ node, ...props }) => (
          <strong className="font-semibold text-zinc-100" {...props} />
        ),
        ul: ({ node, ...props }) => (
          <ul className="list-disc list-outside pl-4 my-2 space-y-1 text-zinc-300" {...props} />
        ),
        ol: ({ node, ...props }) => (
          <ol className="list-decimal list-outside pl-4 my-2 space-y-1 text-zinc-300" {...props} />
        ),
        h1: ({ node, ...props }) => (
          <h1 className="text-base font-bold text-zinc-100 mt-3 mb-1" {...props} />
        ),
        h2: ({ node, ...props }) => (
          <h2 className="text-sm font-semibold text-zinc-200 mt-2 mb-1" {...props} />
        ),
        h3: ({ node, ...props }) => (
          <h3 className="text-xs font-semibold text-zinc-300 mt-2 mb-1" {...props} />
        ),
        a: ({ node, ...props }) => (
          <a
            className="text-blue-400 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          />
        ),
        p: ({ node, ...props }) => <p className="my-1.5 leading-relaxed" {...props} />,
        pre: ({ node, ...props }) => (
          <pre
            className="bg-zinc-950/80 border border-zinc-800/80 p-3 rounded-md overflow-x-auto my-2 font-mono text-xs text-zinc-200"
            {...props}
          />
        ),
        code: ({ node, className, children, ...props }) => {
          const match = /language-(\w+)/.exec(className || '');
          return !match ? (
            <code
              className="bg-zinc-800/60 text-zinc-200 px-1.5 py-0.5 rounded font-mono text-[11px]"
              {...props}
            >
              {children}
            </code>
          ) : (
            <code className={`${className} font-mono text-xs`} {...props}>
              {children}
            </code>
          );
        }
      }}
    >
      {children}
    </ReactMarkdown>
  );
};