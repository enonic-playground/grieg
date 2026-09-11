import type { ComponentProps, ReactElement } from 'react';

import { cn } from '../../lib/utils';

//
// * Table
//

const TABLE_NAME = 'Table';

export const Table = ({ ref, className, ...props }: ComponentProps<'table'>): ReactElement => {
  return (
    <div className="relative w-full overflow-auto">
      <table
        ref={ref}
        data-component={TABLE_NAME}
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
};

Table.displayName = TABLE_NAME;

//
// * TableHeader
//

const TABLE_HEADER_NAME = 'TableHeader';

export const TableHeader = ({
  ref,
  className,
  ...props
}: ComponentProps<'thead'>): ReactElement => {
  return <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />;
};

TableHeader.displayName = TABLE_HEADER_NAME;

//
// * TableBody
//

const TABLE_BODY_NAME = 'TableBody';

export const TableBody = ({ ref, className, ...props }: ComponentProps<'tbody'>): ReactElement => {
  return <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
};

TableBody.displayName = TABLE_BODY_NAME;

//
// * TableFooter
//

const TABLE_FOOTER_NAME = 'TableFooter';

export const TableFooter = ({
  ref,
  className,
  ...props
}: ComponentProps<'tfoot'>): ReactElement => {
  return (
    <tfoot
      ref={ref}
      className={cn('bg-muted/50 border-t font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  );
};

TableFooter.displayName = TABLE_FOOTER_NAME;

//
// * TableRow
//

const TABLE_ROW_NAME = 'TableRow';

export const TableRow = ({ ref, className, ...props }: ComponentProps<'tr'>): ReactElement => {
  return (
    <tr
      ref={ref}
      className={cn(
        'border-b transition-colors duration-100',
        'hover:bg-row-hover data-[state=selected]:bg-accent-muted',
        className,
      )}
      {...props}
    />
  );
};

TableRow.displayName = TABLE_ROW_NAME;

//
// * TableHead
//

const TABLE_HEAD_NAME = 'TableHead';

export const TableHead = ({ ref, className, ...props }: ComponentProps<'th'>): ReactElement => {
  return (
    <th
      ref={ref}
      className={cn(
        'bg-muted sticky top-0 z-10 px-4 py-2',
        'text-muted-foreground text-left align-middle text-[10px] font-semibold',
        'tracking-[0.08em] uppercase',
        '[&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
};

TableHead.displayName = TABLE_HEAD_NAME;

//
// * TableCell
//

const TABLE_CELL_NAME = 'TableCell';

export const TableCell = ({ ref, className, ...props }: ComponentProps<'td'>): ReactElement => {
  return (
    <td
      ref={ref}
      className={cn('px-4 py-2 align-middle font-mono [&:has([role=checkbox])]:pr-0', className)}
      {...props}
    />
  );
};

TableCell.displayName = TABLE_CELL_NAME;

//
// * TableCaption
//

const TABLE_CAPTION_NAME = 'TableCaption';

export const TableCaption = ({
  ref,
  className,
  ...props
}: ComponentProps<'caption'>): ReactElement => {
  return (
    <caption ref={ref} className={cn('text-muted-foreground mt-4 text-sm', className)} {...props} />
  );
};

TableCaption.displayName = TABLE_CAPTION_NAME;
