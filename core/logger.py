import logging
import sys
from collections import deque

_log_buffer = deque(maxlen=250)


class InMemoryLogHandler(logging.Handler):
    def emit(self, record):
        try:
            msg = self.format(record)
            _log_buffer.append(msg)
        except Exception:
            pass


_memory_handler = None


def setup_logger(name: str = "network_monitor") -> logging.Logger:
    global _memory_handler
    logger = logging.getLogger(name)
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        formatter = logging.Formatter(
            "[%(asctime)s] %(levelname)s - %(name)s - %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        stream_handler = logging.StreamHandler(sys.stdout)
        stream_handler.setLevel(logging.INFO)
        stream_handler.setFormatter(formatter)
        logger.addHandler(stream_handler)

        if _memory_handler is None:
            _memory_handler = InMemoryLogHandler()
            _memory_handler.setLevel(logging.INFO)
            _memory_handler.setFormatter(formatter)
        logger.addHandler(_memory_handler)
    return logger


def get_recent_logs() -> list:
    return list(_log_buffer)


def clear_recent_logs():
    _log_buffer.clear()
