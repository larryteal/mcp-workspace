import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './Select.module.css';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  variant?: 'default' | 'primary';
}

export function Select({ value, options, onChange, className, variant = 'default' }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div ref={ref} className={`${styles.select} ${className || ''}`}>
      <button
        type="button"
        className={`${styles.trigger} ${variant === 'primary' ? styles.primary : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={styles.value}>{selectedOption?.label || value}</span>
        <ChevronDown size={16} className={`${styles.icon} ${isOpen ? styles.open : ''}`} />
      </button>
      {isOpen && (
        <div className={styles.dropdown}>
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              className={`${styles.option} ${option.value === value ? styles.selected : ''}`}
              onClick={() => handleSelect(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
