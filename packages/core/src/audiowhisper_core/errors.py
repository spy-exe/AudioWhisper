from audiowhisper_core.enums import ErrorCode


class AppError(Exception):
    """Base application error carrying a stable error code for API responses."""

    status_code: int = 400

    def __init__(self, code: ErrorCode, message: str, details: dict | None = None) -> None:
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(message)


class NotFoundError(AppError):
    status_code = 404

    def __init__(self, message: str, details: dict | None = None) -> None:
        super().__init__(ErrorCode.NOT_FOUND, message, details)


class ValidationAppError(AppError):
    status_code = 422

    def __init__(self, message: str, details: dict | None = None) -> None:
        super().__init__(ErrorCode.VALIDATION_ERROR, message, details)


class FileTooLargeError(AppError):
    status_code = 413

    def __init__(self, message: str, details: dict | None = None) -> None:
        super().__init__(ErrorCode.FILE_TOO_LARGE, message, details)


class UnsupportedFormatError(AppError):
    status_code = 415

    def __init__(self, message: str, details: dict | None = None) -> None:
        super().__init__(ErrorCode.UNSUPPORTED_FORMAT, message, details)


class ConflictError(AppError):
    status_code = 409

    def __init__(self, message: str, details: dict | None = None) -> None:
        super().__init__(ErrorCode.CONFLICT, message, details)


class QueueUnavailableError(AppError):
    status_code = 503

    def __init__(self, message: str = "A fila de processamento está indisponível. Verifique o Redis e tente novamente.",
                 details: dict | None = None) -> None:
        super().__init__(ErrorCode.QUEUE_UNAVAILABLE, message, details)
