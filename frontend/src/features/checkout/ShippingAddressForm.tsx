import { Input } from '@/components/ui/Input';

export interface ShippingFormValues {
  fullName: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  phone: string;
}

interface ShippingAddressFormProps {
  values: ShippingFormValues;
  errors: Record<string, string>;
  disabled?: boolean;
  onChange: (field: keyof ShippingFormValues, value: string) => void;
}

export function ShippingAddressForm({
  values,
  errors,
  disabled = false,
  onChange,
}: ShippingAddressFormProps) {
  return (
    <div className="space-y-4">
      <Input
        id="shipping-fullName"
        label="Full Name"
        required
        autoComplete="name"
        maxLength={100}
        disabled={disabled}
        value={values.fullName}
        error={errors.fullName}
        onChange={(e) => onChange('fullName', e.target.value)}
        placeholder="Jane Doe"
      />

      <Input
        id="shipping-line1"
        label="Address Line 1"
        required
        autoComplete="address-line1"
        maxLength={200}
        disabled={disabled}
        value={values.line1}
        error={errors.line1}
        onChange={(e) => onChange('line1', e.target.value)}
        placeholder="123 Market St"
      />

      <Input
        id="shipping-line2"
        label="Address Line 2 (Optional)"
        autoComplete="address-line2"
        maxLength={200}
        disabled={disabled}
        value={values.line2}
        error={errors.line2}
        onChange={(e) => onChange('line2', e.target.value)}
        placeholder="Suite 400"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="shipping-city"
          label="City"
          required
          autoComplete="address-level2"
          maxLength={100}
          disabled={disabled}
          value={values.city}
          error={errors.city}
          onChange={(e) => onChange('city', e.target.value)}
          placeholder="San Francisco"
        />
        <Input
          id="shipping-region"
          label="State / Region"
          required
          autoComplete="address-level1"
          maxLength={100}
          disabled={disabled}
          value={values.region}
          error={errors.region}
          onChange={(e) => onChange('region', e.target.value)}
          placeholder="CA"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="shipping-postalCode"
          label="US ZIP Code"
          required
          autoComplete="postal-code"
          maxLength={10}
          disabled={disabled}
          value={values.postalCode}
          error={errors.postalCode}
          hint="5-digit ZIP or ZIP+4 (e.g., 94107)"
          onChange={(e) => onChange('postalCode', e.target.value)}
          placeholder="94107"
        />
        <Input
          id="shipping-country"
          label="Country"
          value="US (United States)"
          disabled
          hint="Test-market checkout currently supports US addresses only."
        />
      </div>

      <Input
        id="shipping-phone"
        label="Phone Number (Optional)"
        type="tel"
        autoComplete="tel"
        maxLength={16}
        disabled={disabled}
        value={values.phone}
        error={errors.phone}
        hint="Optional E.164 format (e.g., +14155550199)"
        onChange={(e) => onChange('phone', e.target.value)}
        placeholder="+14155550199"
      />
    </div>
  );
}
