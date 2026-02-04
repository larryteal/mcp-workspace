import React from 'react';
import styles from './Card.module.css';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  headerRight?: React.ReactNode;
}

export function Card({ children, className, title, headerRight }: CardProps) {
  return (
    <div className={`${styles.card} ${className || ''}`}>
      {(title || headerRight) && (
        <div className={styles.header}>
          {title && <h3 className={styles.title}>{title}</h3>}
          {headerRight && <div className={styles.headerRight}>{headerRight}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
