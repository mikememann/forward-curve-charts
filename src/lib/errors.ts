export class DataError extends Error {
  constructor(
    message: string,
    readonly symbol = "",
  ) {
    super(message);
    this.name = "DataError";
  }
}
