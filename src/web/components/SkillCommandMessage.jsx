import { useMemo } from 'preact/hooks';
import { parseSkillCommand } from '../composer.js';
import MessageBubble, { renderMarkdown } from './MessageBubble.js';
import SkillCommandPill from './SkillCommandPill.jsx';


export default function SkillCommandMessage({ content, error = false }) {
  const command = parseSkillCommand(content);
  const taskHtml = useMemo(() => command && !error ? renderMarkdown(command.task) : '', [command?.task, error]);
  if (!command || error) return <MessageBubble content={content} error={error} />;
  return <div class="message-bubble markdown skill-command-message text-base-content [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-3 [&_blockquote]:border-base-300 [&_blockquote]:pl-4 [&_blockquote]:text-base-content/70 [&_code]:rounded [&_code]:bg-base-200 [&_code]:px-1 [&_code]:py-0.5 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:[overflow-wrap:anywhere] [&_pre]:rounded-box [&_pre]:border [&_pre]:border-base-300 [&_pre]:bg-base-200 [&_pre]:p-3 [&_table]:border-collapse [&_th]:bg-base-200 [&_td]:border [&_th]:border [&_td]:border-base-300 [&_th]:border-base-300 [&_td]:p-1.5 [&_th]:p-1.5">
    <SkillCommandPill skillId={command.id} />
    {command.task && <div class="skill-command-task" dangerouslySetInnerHTML={{ __html: taskHtml }} />}
  </div>;
}
