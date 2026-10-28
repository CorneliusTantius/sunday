import { h } from 'preact';
import { useMemo } from 'preact/hooks';
import MarkdownIt from 'markdown-it';

// No raw HTML or images: chat content must not automatically fetch resources.
const markdown = new MarkdownIt({ html: false, breaks: true }).disable('image');
const validateLink = markdown.validateLink;
// The default validator allows raster data URLs; reject all data links as well.
markdown.validateLink = url => !/^data:/i.test(url.trim()) && validateLink(url);
markdown.renderer.rules.table_open = () => '<div class="markdown-table" tabindex="0" role="region" aria-label="Table"><table>\n';
markdown.renderer.rules.table_close = () => '</table></div>\n';

export function renderMarkdown(content) {
  return markdown.render(content);
}

export default function MessageBubble({ content, error = false }) {
  const html = useMemo(() => error ? '' : renderMarkdown(content), [content, error]);
  return error
    ? h('div', { class: 'message-bubble error-text text-error whitespace-pre-wrap' }, content)
    : h('div', { class: 'message-bubble markdown text-base-content [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-3 [&_blockquote]:border-base-300 [&_blockquote]:pl-4 [&_blockquote]:text-base-content/70 [&_code]:rounded [&_code]:bg-base-200 [&_code]:px-1 [&_code]:py-0.5 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:[overflow-wrap:anywhere] [&_pre]:rounded-box [&_pre]:border [&_pre]:border-base-300 [&_pre]:bg-base-200 [&_pre]:p-3 [&_table]:border-collapse [&_th]:bg-base-200 [&_td]:border [&_th]:border [&_td]:border-base-300 [&_th]:border-base-300 [&_td]:p-1.5 [&_th]:p-1.5', dangerouslySetInnerHTML: { __html: html } });
}
