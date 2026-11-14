import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';

/**
 * The Attract Mode button: a slanted panel with the label in italic capitals.
 * Scaffolded with the shadcn/ui CLI, then restyled to
 * .interface-design/system.md. `gold` is the one primary action on a screen;
 * it is the only variant that glows.
 */
const buttonVariants = cva(
  [
    'slab display inline-flex shrink-0 cursor-pointer items-center justify-center gap-[0.5em] border-0 bg-transparent leading-none tracking-[0.04em] whitespace-nowrap no-underline',
    'transition-transform duration-100 active:translate-y-0.5 motion-reduce:transition-none',
    'before:transition-[filter] before:duration-150 hover:before:brightness-125',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        deck: 'text-white [--slab:var(--color-deck-3)]',
        gold: 'text-gold-ink [--slab:var(--color-gold)] [--slab-glow:0_0_34px_rgb(255_210_63/0.5)]',
      },
      size: {
        sm: 'h-11 px-6 text-[21px]',
        default: 'h-[58px] px-[34px] text-[25px]',
        xl: 'h-[90px] px-[54px] text-[46px] max-sm:h-[72px] max-sm:px-9 max-sm:text-[34px]',
      },
    },
    defaultVariants: {
      variant: 'deck',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'deck',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
