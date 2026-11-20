import Markdown from 'react-markdown';

/** A post-mortem from docs/postmortems. Raw HTML is dropped; links open in a new tab. */
export function Postmortem({ text }: { text: string }) {
  return (
    <div className="prose">
      <Markdown
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
