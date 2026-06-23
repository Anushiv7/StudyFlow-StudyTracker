# Layered Stack

A stack of layered cards that reset and spring out on mouse interactions.

## Installation

```bash
npx componentry@latest add layered-stack
```

**Dependencies:** gsap

## Source Code

```tsx
"use client";

import { ComponentProps, useCallback, useEffect, useRef } from "react";
import gsap from "gsap";
import { cn } from "@/lib/utils";

export type LayeredStackProps = ComponentProps<"div">;

export const LayeredStack = ({ children, className, ...props }: LayeredStackProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const isStacked = useRef(true);

    const stackCards = useCallback((animate = true) => {
        const container = containerRef.current;
        if (!container) return;

        isStacked.current = true;
        const cards = Array.from(container.children) as HTMLElement[];

        // First clear all transforms so offsetLeft/offsetTop reflect true grid positions
        cards.forEach((card) => {
            gsap.killTweensOf(card);
        });

        if (!animate) {
            // Instant reposition: clear transforms, recalculate, set immediately
            cards.forEach((card) => gsap.set(card, { x: 0, y: 0, rotate: 0 }));
            // Wait a frame so the browser recalculates layout
            requestAnimationFrame(() => {
                const container = containerRef.current;
                if (!container || !isStacked.current) return;
                const cards = Array.from(container.children) as HTMLElement[];
                cards.forEach((card, i) => {
                    const offsetX = container.clientWidth / 2 - card.offsetWidth / 2 - card.offsetLeft;
                    const offsetY = container.clientHeight / 2 - card.offsetHeight / 2 - card.offsetTop;
                    gsap.set(card, {
                        x: offsetX,
                        y: offsetY,
                        rotate: gsap.utils.random(-10, 10),
                        zIndex: 100 - i,
                    });
                });
            });
            return;
        }

        // Animated: first clear, then after layout recalc, animate to center
        cards.forEach((card) => gsap.set(card, { x: 0, y: 0, rotate: 0 }));
        requestAnimationFrame(() => {
            const container = containerRef.current;
            if (!container || !isStacked.current) return;
            const cards = Array.from(container.children) as HTMLElement[];
            cards.forEach((card, i) => {
                const offsetX = container.clientWidth / 2 - card.offsetWidth / 2 - card.offsetLeft;
                const offsetY = container.clientHeight / 2 - card.offsetHeight / 2 - card.offsetTop;
                gsap.to(card, {
                    x: offsetX,
                    y: offsetY,
                    rotate: gsap.utils.random(-10, 10),
                    zIndex: 100 - i,
                    duration: 0.8,
                    ease: "expo.out",
                    overwrite: true,
                });
            });
        });
    }, []);

    const resetCards = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;

        isStacked.current = false;
        const cards = Array.from(container.children) as HTMLElement[];

        gsap.to(cards, {
            x: 0,
            y: 0,
            zIndex: (i: number) => 100 - i,
            duration: 0.8,
            rotate: 0,
            ease: "expo.out",
            stagger: {
                amount: 0.1,
                from: "start",
            },
            overwrite: true,
        });
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Initial z-index setup
        const cards = Array.from(container.children) as HTMLElement[];
        cards.forEach((card, i) => {
            gsap.set(card, { zIndex: 100 - i });
        });

        stackCards();

        // Re-run current state on resize
        const ro = new ResizeObserver(() => {
            if (isStacked.current) {
                stackCards(false);
            }
            // If expanded (reset), transforms are already 0 so nothing to fix
        });
        ro.observe(container);

        return () => ro.disconnect();
    }, [stackCards]);

    return (
        <div
            ref={containerRef}
            onMouseEnter={resetCards}
            onMouseLeave={() => stackCards(true)}
            className={cn("relative", className)}
            {...props}>
            {children}
        </div>
    );
};

```

## Usage

```tsx
import { LayeredStack } from "@/components/ui/layered-stack"

const images = [
    "https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&q=80&w=800",
    "https://images.unsplash.com/photo-1507413245164-6160d8298b31?auto=format&fit=crop&q=80&w=800",
    "https://images.unsplash.com/photo-1517976487492-5750f3195933?auto=format&fit=crop&q=80&w=800",
    "https://images.unsplash.com/photo-1581093450021-4a7360e9a6b5?auto=format&fit=crop&q=80&w=800",
    "https://images.unsplash.com/photo-1530026405186-ed1f139313f8?auto=format&fit=crop&q=80&w=800",
    "https://images.unsplash.com/photo-1507668077129-56e32842fceb?auto=format&fit=crop&q=80&w=800",
    "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80&w=800",
    "https://images.unsplash.com/photo-1633167606207-d840b5070fc2?auto=format&fit=crop&q=80&w=800",
];

export const Demo = () => {
    return (
        <LayeredStack className="w-full max-w-[920px] grid grid-cols-4 gap-4 p-8">
            {images.map((img, i) => (
                <img key={i} src={img} alt={`Scientific element ${i}`} className="object-cover w-full aspect-[250/320] shadow-xl" />
            ))}
        </LayeredStack>
    );
};
```

## API Reference (Props)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | The layered items inside the stack. |
| `className` | `string` | - | Additional CSS classes for styling. |

---

_Component from [Componentry](https://componentry.fun/docs/components/layered-stack)_
