"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@cohory/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function ClampedDescription({
  name,
  text,
  join = null,
}: {
  name: string;
  text: string;
  join?: ReactNode;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [cut, setCut] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div className="relative max-w-2xl">
      <p
        ref={ref}
        className="line-clamp-2 text-base whitespace-pre-line break-words text-text md:line-clamp-3"
      >
        {text}
      </p>
      {cut ? (
        <Dialog>
          <DialogTrigger className="absolute right-0 bottom-0 rounded-sm bg-linear-to-l from-surface from-70% to-transparent pl-8 text-base leading-6 font-medium text-accent outline-none after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-[''] hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            more<span className="sr-only"> about {name}</span>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{name}</DialogTitle>
            </DialogHeader>
            <p className="text-base whitespace-pre-line break-words text-text">{text}</p>
            {join ? (
              <div data-slot="dialog-join" className="flex flex-col pt-2">
                {join}
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
