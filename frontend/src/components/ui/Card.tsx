import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'normal' | 'large';
}

export default function Card({ children, className = '', padding = 'normal' }: CardProps) {
  const pad = padding === 'none' ? '' : padding === 'large' ? 'p-6' : 'p-5';
  return (
    <div className={`rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] ${pad} ${className}`}>
      {children}
    </div>
  );
}
