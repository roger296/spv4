import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { COUNTRIES } from '@/lib/countries';

export interface AddressValues {
  contactName: string;
  company: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postCode: string;
  country: string;
  phone: string;
  email: string;
}

export const EMPTY_ADDRESS: AddressValues = {
  contactName: '',
  company: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postCode: '',
  country: 'GB',
  phone: '',
  email: '',
};

/** From an API row (nulls) to form strings. */
export function addressFromRow(row: Partial<Record<keyof AddressValues, string | null | undefined>>): AddressValues {
  return {
    contactName: row.contactName ?? '',
    company: row.company ?? '',
    line1: row.line1 ?? '',
    line2: row.line2 ?? '',
    city: row.city ?? '',
    region: row.region ?? '',
    postCode: row.postCode ?? '',
    country: row.country ?? 'GB',
    phone: row.phone ?? '',
    email: row.email ?? '',
  };
}

/** From form strings to the API body: blanks become null for optional fields. */
export function addressToBody(v: AddressValues) {
  return {
    contactName: v.contactName.trim(),
    company: v.company.trim() || null,
    line1: v.line1.trim(),
    line2: v.line2.trim() || null,
    city: v.city.trim(),
    region: v.region.trim() || null,
    postCode: v.postCode.trim(),
    country: v.country.trim().toUpperCase(),
    phone: v.phone.trim() || null,
    email: v.email.trim() || null,
  };
}

export function formatAddressLines(a: Partial<Record<keyof AddressValues, string | null>>): string[] {
  return [a.contactName, a.company, a.line1, a.line2, [a.city, a.region].filter(Boolean).join(', '), a.postCode, a.country]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
}

interface AddressFieldsProps {
  value: AddressValues;
  onChange: (next: AddressValues) => void;
  idPrefix?: string;
  /** Hide the contact name (warehouses use their own name field). */
  requireContact?: boolean;
}

export function AddressFields({ value, onChange, idPrefix = 'addr', requireContact = true }: AddressFieldsProps) {
  const set = (k: keyof AddressValues) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor={id('contactName')}>Contact name{requireContact ? '' : ' (optional)'}</Label>
        <Input id={id('contactName')} value={value.contactName} onChange={set('contactName')} autoComplete="name" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={id('company')}>Company</Label>
        <Input id={id('company')} value={value.company} onChange={set('company')} autoComplete="organization" />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={id('line1')}>Address line 1</Label>
        <Input id={id('line1')} value={value.line1} onChange={set('line1')} autoComplete="address-line1" />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={id('line2')}>Address line 2</Label>
        <Input id={id('line2')} value={value.line2} onChange={set('line2')} autoComplete="address-line2" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={id('city')}>Town or city</Label>
        <Input id={id('city')} value={value.city} onChange={set('city')} autoComplete="address-level2" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={id('region')}>County or region</Label>
        <Input id={id('region')} value={value.region} onChange={set('region')} autoComplete="address-level1" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={id('postCode')}>Postcode</Label>
        <Input id={id('postCode')} value={value.postCode} onChange={set('postCode')} autoComplete="postal-code" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={id('country')}>Country</Label>
        <Select value={value.country} onValueChange={(country) => onChange({ ...value, country })}>
          <SelectTrigger id={id('country')}>
            <SelectValue placeholder="Country" />
          </SelectTrigger>
          <SelectContent>
            {COUNTRIES.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.name}
              </SelectItem>
            ))}
            {!COUNTRIES.some((c) => c.code === value.country) && value.country && <SelectItem value={value.country}>{value.country}</SelectItem>}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={id('phone')}>Phone</Label>
        <Input id={id('phone')} value={value.phone} onChange={set('phone')} autoComplete="tel" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={id('email')}>Email</Label>
        <Input id={id('email')} type="email" value={value.email} onChange={set('email')} autoComplete="email" />
      </div>
    </div>
  );
}
