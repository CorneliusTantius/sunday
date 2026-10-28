import { useMemo } from 'preact/hooks';
import { parseSkillCommand } from '../composer.js';
import MessageBubble, { markdownClass, renderMarkdown } from './MessageBubble.js';
import SkillCommandPill from './SkillCommandPill.jsx';


export default function SkillCommandMessage({ content, error = false }) {
  const command = parseSkillCommand(content);
  const taskHtml = useMemo(() => command && !error ? renderMarkdown(command.task) : '', [command?.task, error]);
  if (!command || error) return <MessageBubble content={content} error={error} />;
  return <div class={markdownClass}>
    <SkillCommandPill skillId={command.id} />
    {command.task && <div class="[&>*:last-child]:mb-0" dangerouslySetInnerHTML={{ __html: taskHtml }} />}
  </div>;
}
