import { h } from 'preact';
import { useMemo } from 'preact/hooks';
import MarkdownIt from 'markdown-it';

// No raw HTML or images: chat content must not automatically fetch resources.
const markdown = new MarkdownIt({ html: false, breaks: true }).disable('image');
const validateLink = markdown.validateLink;
// The default validator allows raster data URLs; reject all data links as well.
markdown.validateLink = url => !/^data:/i.test(url.trim()) && validateLink(url);
markdown.renderer.rules.table_open = () => '<div class="mb-4 max-w-full overflow-x-auto" tabindex="0" role="region" aria-label="Table"><table>\n';
markdown.renderer.rules.table_close = () => '</table></div>\n';

export function renderMarkdown(content) {
  return markdown.render(content);
}

export const markdownClass = 'min-w-0 max-w-[min(82%,660px)] max-sm:max-w-[90%] whitespace-normal text-base-content [.assistant_&]:max-w-full [.assistant_&]:py-[3px] [.user_&]:rounded-3xl [.user_&]:border [.user_&]:border-base-300 [.user_&]:bg-base-200 [.user_&]:px-4 [.user_&]:py-3 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:mb-4 [&_ul]:mb-4 [&_ol]:mb-4 [&_blockquote]:mb-4 [&_pre]:mb-4 [&_h1]:my-4 [&_h1]:text-[1.6em] [&_h2]:my-4 [&_h2]:text-[1.4em] [&_h3]:my-4 [&_h3]:text-[1.2em] [&_h4]:my-4 [&_h5]:my-4 [&_h6]:my-4 [&_ul]:pl-6 [&_ol]:pl-6 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-[3px] [&_blockquote]:border-base-300 [&_blockquote]:pl-4 [&_blockquote]:text-base-content/70 [&_code]:rounded-field [&_code]:bg-base-200 [&_code]:px-1 [&_code]:py-0.5 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:[overflow-wrap:anywhere] [&_pre]:rounded-box [&_pre]:border [&_pre]:border-base-300 [&_pre]:bg-base-200 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:[white-space:inherit] [&_table]:w-full [&_table]:border-collapse [&_table]:whitespace-normal [&_th]:min-w-24 [&_td]:min-w-24 [&_th]:border [&_td]:border [&_td]:border-base-300 [&_th]:border-base-300 [&_th]:bg-base-200 [&_th]:font-bold [&_td]:p-1.5 [&_th]:p-1.5';

export default function MessageBubble({ content, error = false }) {
  const html = useMemo(() => error ? '' : renderMarkdown(content), [content, error]);
  return error
    ? h('div', { class: 'min-w-0 max-w-[min(82%,660px)] max-sm:max-w-[90%] whitespace-pre-wrap text-error [.assistant_&]:max-w-full [.assistant_&]:py-[3px] [.user_&]:rounded-3xl [.user_&]:border [.user_&]:border-base-300 [.user_&]:bg-base-200 [.user_&]:px-4 [.user_&]:py-3' }, content)
    : h('div', { class: markdownClass, dangerouslySetInnerHTML: { __html: html } });
}
