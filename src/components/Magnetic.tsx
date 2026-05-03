import { ReactNode, ElementType } from 'react';
import { useMagnetic } from '../hooks/useMagnetic';

interface Props {
  as?: ElementType;
  className?: string;
  strength?: number;
  range?: number;
  children: ReactNode;
  [key: string]: unknown;
}

/**
 * Wraps a child with the magnetic-cursor effect.
 * Default to <span> so it doesn't disturb layout flow.
 */
export default function Magnetic({
  as: Tag = 'span',
  className,
  strength = 0.22,
  range = 90,
  children,
  ...rest
}: Props) {
  const ref = useMagnetic<HTMLElement>(strength, range);
  return (
    <Tag
      ref={ref as never}
      className={`magnet ${className ?? ''}`.trim()}
      {...rest}
    >
      {children}
    </Tag>
  );
}
