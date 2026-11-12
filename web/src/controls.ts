/** Segmented toggles: a fieldset of radio buttons that reads and sets like a select. */
export class Toggle<T extends string> {
  private inputs: HTMLInputElement[];
  constructor(name: string) { this.inputs = [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)]; }
  get value(): T { return (this.inputs.find((i) => i.checked)?.value ?? this.inputs[0].value) as T; }
  set value(v: T) { for (const i of this.inputs) i.checked = i.value === v; }
  onChange(cb: (v: T) => void): void { for (const i of this.inputs) i.addEventListener("change", () => { if (i.checked) cb(i.value as T); }); }
}
