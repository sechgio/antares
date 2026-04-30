import React from 'react';

interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'error';
  className?: string;
  children: React.ReactNode;
}

export default function Badge({
  variant = 'default',
  className = '',
  children,
}: BadgeProps) {
  const base = 'inline-flex items-center px-2.5 py-0.5 rounded-pill text-xs font-bold tracking-wide';
  const variants = {
    default: 'bg-dark-elevated text-txt-secondary border border-bdr-subtle',
    success: 'bg-accent-green/10 text-accent-green border border-accent-green/20',
    warning: 'bg-accent-yellow/10 text-accent-yellow border border-accent-yellow/20',
    error: 'bg-accent-red/10 text-accent-red border border-accent-red/20',
  };

  return (
    <span className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}
