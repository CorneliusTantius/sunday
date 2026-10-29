import { Fragment } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

const pageSize = 40;

// Only presentation is paginated: the complete history remains available to chat.
export default function MessageHistory({ messages, transcript, children, insert, insertAt }) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const anchor = useRef(null);
  const start = Math.max(0, messages.length - visibleCount);

  useLayoutEffect(() => {
    if (!anchor.current || !transcript.current) return;
    const { height, top } = anchor.current;
    transcript.current.scrollTop = top + transcript.current.scrollHeight - height;
    anchor.current = null;
  }, [visibleCount]);

  function showOlder() {
    const element = transcript.current;
    if (element) anchor.current = { height: element.scrollHeight, top: element.scrollTop };
    setVisibleCount(count => count + pageSize);
  }

  return <>
    {start > 0 && <button type="button" class="btn btn-ghost btn-sm self-start text-base-content/70 hover:text-base-content" onClick={showOlder}>Show older messages ({start})</button>}
    {insert && insertAt === start && insert}
    {messages.slice(start).map((message, index) => <Fragment key={start + index}>
      {children(message, start + index)}
      {insert && insertAt === start + index + 1 && insert}
    </Fragment>)}
  </>;
}
