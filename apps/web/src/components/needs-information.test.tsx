import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { missingFieldLabel, missingFieldLink, NeedsInformation, NoMethodFits } from './needs-information';
import { errorFromBody, NeedsInformationError, NoMethodError } from '@/lib/api';

// The renderer links out to the products page; a plain anchor stands in for
// the router's Link so the component can mount without a router.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, search, children, ...rest }: { to: string; search?: Record<string, string>; children: React.ReactNode }) => (
    <a href={`${to}${search ? `?${new URLSearchParams(search)}` : ''}`} {...rest}>
      {children}
    </a>
  ),
}));

describe('errorFromBody', () => {
  it('turns a 422 needs_information reply into a NeedsInformationError', () => {
    const err = errorFromBody(422, {
      status: 'needs_information',
      reference: 'WEB-1',
      orderStatus: 'UPDATE_PRODUCT',
      missing: [{ path: 'lines[0].weight', reason: 'No weight on file for SKU-1' }],
      resume: 'POST /v4/orders/WEB-1/label',
    });
    expect(err).toBeInstanceOf(NeedsInformationError);
    expect((err as NeedsInformationError).body.missing).toHaveLength(1);
  });

  it('turns a 422 no_method reply into a NoMethodError', () => {
    const err = errorFromBody(422, { status: 'no_method', reference: 'WEB-2', dropped: [{ name: 'RM 24', reason: 'Too heavy' }] });
    expect(err).toBeInstanceOf(NoMethodError);
  });

  it('reads the standard error envelope', () => {
    const err = errorFromBody(409, { error: { code: 'conflict', message: 'Order is shipped and cannot be edited' } });
    expect(err.code).toBe('conflict');
    expect(err.message).toBe('Order is shipped and cannot be edited');
    expect(err.notAvailable).toBe(false);
  });

  it('treats a bare 404 (no envelope) as "not available yet"', () => {
    expect(errorFromBody(404, undefined).notAvailable).toBe(true);
    expect(errorFromBody(404, { error: { code: 'not_found', message: 'order X not found' } }).notAvailable).toBe(false);
  });
});

describe('missing field helpers', () => {
  it('labels a path in plain English', () => {
    expect(missingFieldLabel('lines[0].weight')).toBe('Lines 1 › weight');
    expect(missingFieldLabel('deliveryAddress.postCode')).toBe('Delivery address › post code');
  });

  it('links product fields to the product, and dimension fields to the incomplete list', () => {
    expect(missingFieldLink('lines[0].weight', 'SKU-1')).toMatchObject({ to: '/products', search: { q: 'SKU-1' } });
    expect(missingFieldLink('parcels[0].height')).toMatchObject({ to: '/products', search: { incomplete: 'true' } });
    expect(missingFieldLink('deliveryAddress.postCode')).toBeNull();
  });
});

describe('<NeedsInformation>', () => {
  it('lists every missing field with its reason and a product link', async () => {
    const onRetry = vi.fn();
    render(
      <NeedsInformation
        reference="WEB-1"
        missing={[
          { path: 'lines[0].weight', reason: 'No weight on file', alternatives: ['Enter a parcel weight'] },
          { path: 'deliveryAddress.postCode', reason: 'Postcode is required for GB', options: ['SW1A 1AA'] },
        ]}
        lineSkus={['SKU-1']}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Order WEB-1 needs more information');
    expect(screen.getByText('No weight on file')).toBeInTheDocument();
    expect(screen.getByText('Postcode is required for GB')).toBeInTheDocument();
    expect(screen.getByText(/Alternatives: Enter a parcel weight/)).toBeInTheDocument();
    expect(screen.getByText(/Options: SW1A 1AA/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open product SKU-1' });
    expect(link).toHaveAttribute('href', '/products?q=SKU-1');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('<NoMethodFits>', () => {
  it('lists the dropped methods and why', () => {
    render(<NoMethodFits reference="WEB-2" dropped={[{ name: 'RM Tracked 24', reason: 'Over 20 kg' }]} />);
    expect(screen.getByRole('alert')).toHaveTextContent('No shipping method fits order WEB-2');
    expect(screen.getByText('RM Tracked 24')).toBeInTheDocument();
    expect(screen.getByText(/Over 20 kg/)).toBeInTheDocument();
  });
});
