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
    ? h('div', { class: 'message-bubble error-text' }, content)
    : h('div', { class: 'message-bubble markdown', dangerouslySetInnerHTML: { __html: html } });
}
