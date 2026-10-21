import Markdown from "react-markdown";

export function DocumentContent({ content, headingLevel = 2 }: { content: string; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const Subheading = headingLevel === 3 ? "h4" : "h3";
  return (
    <div className="document-preview">
      <Markdown skipHtml components={{
        h1: ({ children }) => <Heading>{children}</Heading>,
        h2: ({ children }) => <Subheading>{children}</Subheading>,
        img: () => null,
        a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-4">{children}</a> : <span>{children}</span>,
      }}>{content}</Markdown>
    </div>
  );
}
