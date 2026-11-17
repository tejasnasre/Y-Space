import { CopyButton } from "@/components/copy-button";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

/** Read-only value with a copy button, used for the join link and secret. */
export function ShareField({ label, value, testId, mono }: { label: string; value: string; testId: string; mono?: boolean }) {
  return (
    <Field>
      <FieldLabel htmlFor={testId}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput id={testId} readOnly value={value} className={mono ? "font-mono" : undefined} data-testid={testId} />
        <InputGroupAddon align="inline-end">
          <CopyButton value={value} label={label.toLowerCase()} />
        </InputGroupAddon>
      </InputGroup>
    </Field>
  );
}
