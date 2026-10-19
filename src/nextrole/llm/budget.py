"""Per-run token/cost budget. One instance is shared by every LLM call in a run."""
from dataclasses import dataclass


class BudgetExceeded(RuntimeError):
    """Raised before a call when the run's cap has already been reached."""


@dataclass
class Budget:
    max_tokens: int
    max_cost_usd: float
    price_in_per_mtok: float
    price_out_per_mtok: float
    tokens_used: int = 0
    cost_usd: float = 0.0

    def check(self) -> None:
        """Fail fast before spending more. Called ahead of each LLM request."""
        if self.tokens_used >= self.max_tokens or self.cost_usd >= self.max_cost_usd:
            raise BudgetExceeded(
                f"budget exhausted: {self.tokens_used} tokens, ${self.cost_usd:.4f}"
            )

    def charge(self, input_tokens: int, output_tokens: int) -> float:
        """Record usage and return the cost of this call in USD."""
        cost = (
            input_tokens * self.price_in_per_mtok + output_tokens * self.price_out_per_mtok
        ) / 1_000_000
        self.tokens_used += input_tokens + output_tokens
        self.cost_usd += cost
        return cost

    @classmethod
    def from_settings(cls, s) -> "Budget":
        return cls(s.run_max_tokens, s.run_max_cost_usd, s.price_in_per_mtok, s.price_out_per_mtok)
