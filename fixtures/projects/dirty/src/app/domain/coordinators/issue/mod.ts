// Hand-authored L4 fixture with a deliberate violation — a coordinator that
// blind-casts to a DTO class instead of validating the seam (no-dto-cast).
interface WidgetDto {
  id: string;
}

export function issue(raw: unknown): WidgetDto {
  return raw as WidgetDto; // no-dto-cast: validate with assert(WidgetDto, ...)
}
