import React, { forwardRef } from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'nav' | 'card';
  size?: 'none' | 'sm' | 'md' | 'lg';
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className = '',
  children,
  ...props
}, ref) {
  const sizeClasses = {
    none: '',
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-5 py-2 text-sm',
    lg: 'px-7 py-3 text-base',
  };

  const variants = {
    primary: 'inline-flex items-center justify-center gap-2 rounded-full text-[var(--text-on-accent)] font-medium bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:bg-[var(--bg-input)]',
    secondary: 'inline-flex items-center justify-center gap-2 rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)]',
    ghost: 'inline-flex items-center justify-center gap-2 rounded-full bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]',
    danger: 'inline-flex items-center justify-center gap-2 rounded-full bg-transparent text-[var(--accent-red)] border border-[var(--accent-red)] hover:bg-[var(--bg-elevated)]',
    nav: 'flex w-full items-center justify-start gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium',
    card: 'block h-auto w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-left hover:border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]',
  };

  return (
    <button
      ref={ref}
      data-slot="button"
      type={type}
      className={`transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] ${sizeClasses[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});

Button.displayName = 'Button';

export default Button;
