import type { ComponentProps, ReactElement } from 'react';

import { cn } from '../../lib/utils';

//
// * Card
//

const CARD_NAME = 'Card';

export const Card = ({ ref, className, ...props }: ComponentProps<'div'>): ReactElement => {
  return (
    <div
      ref={ref}
      data-component={CARD_NAME}
      className={cn('bg-card text-card-foreground rounded-lg border shadow-sm', className)}
      {...props}
    />
  );
};

Card.displayName = CARD_NAME;

//
// * CardHeader
//

const CARD_HEADER_NAME = 'CardHeader';

export const CardHeader = ({ ref, className, ...props }: ComponentProps<'div'>): ReactElement => {
  return <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />;
};

CardHeader.displayName = CARD_HEADER_NAME;

//
// * CardTitle
//

const CARD_TITLE_NAME = 'CardTitle';

export const CardTitle = ({ ref, className, ...props }: ComponentProps<'h3'>): ReactElement => {
  return (
    <h3
      ref={ref}
      className={cn('text-2xl leading-none font-semibold tracking-tight', className)}
      {...props}
    />
  );
};

CardTitle.displayName = CARD_TITLE_NAME;

//
// * CardDescription
//

const CARD_DESCRIPTION_NAME = 'CardDescription';

export const CardDescription = ({
  ref,
  className,
  ...props
}: ComponentProps<'p'>): ReactElement => {
  return <p ref={ref} className={cn('text-muted-foreground text-sm', className)} {...props} />;
};

CardDescription.displayName = CARD_DESCRIPTION_NAME;

//
// * CardContent
//

const CARD_CONTENT_NAME = 'CardContent';

export const CardContent = ({ ref, className, ...props }: ComponentProps<'div'>): ReactElement => {
  return <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />;
};

CardContent.displayName = CARD_CONTENT_NAME;

//
// * CardFooter
//

const CARD_FOOTER_NAME = 'CardFooter';

export const CardFooter = ({ ref, className, ...props }: ComponentProps<'div'>): ReactElement => {
  return <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />;
};

CardFooter.displayName = CARD_FOOTER_NAME;
