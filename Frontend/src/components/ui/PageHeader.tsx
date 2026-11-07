import { useLanguage } from '../../contexts/LanguageContext';
import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  const { heading } = useLanguage();
  return (
    <div className="flex min-w-0 flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[17px] font-semibold tracking-tight text-ink">{heading(title)}</h1>
        {description && (
          <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-muted">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
