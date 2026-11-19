import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A preview slot that fills its tile and renders `children` (the preview, which reads the image) only once it scrolls
 * near the viewport. Without `IntersectionObserver` it renders them at once.
 */
export function LazyPreview({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (visible || !el) return;
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((r) => r.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);
  return (
    <div ref={ref} className="size-full bg-muted">
      {visible ? children : null}
    </div>
  );
}
