import { useLayoutEffect, useRef, useState } from 'preact/hooks';

const pageSize = 40;

// Only presentation is paginated: the complete history remains available to chat.
export default function MessageHistory({ messages, transcript, children }) {
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
    {start > 0 && <button type="button" class="show-older-messages" onClick={showOlder}>Show older messages ({start})</button>}
    {messages.slice(start).map((message, index) => children(message, start + index))}
  </>;
}
