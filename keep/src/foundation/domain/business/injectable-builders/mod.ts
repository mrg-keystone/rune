export class InjectValue {
  constructor(
    public provide: unknown,
    public useValue: unknown,
  ) {}
}

export class InjectFactory {
  constructor(
    public provide: unknown,
    public useFactory: (...args: unknown[]) => unknown,
  ) {}
}

export class InjectClass {
  constructor(
    public provide: unknown,
    public useClass: unknown,
  ) {}
}
