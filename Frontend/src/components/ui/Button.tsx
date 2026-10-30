import React from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const styles: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-ink/90',
  secondary: 'border border-line bg-white text-ink hover:border-line-strong hover:bg-sunken/60',
  danger: 'bg-bad text-white hover:bg-bad/90',
  ghost: 'text-muted hover:bg-sunken hover:text-ink',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[12.5px]'
      } ${styles[variant]} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}
