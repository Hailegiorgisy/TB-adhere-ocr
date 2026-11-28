function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function calculateTotal({ unitPrice, quantity = 1, serviceRate = 0.10, includesService = false }) {
  const base = Math.max(0, round2(Number(unitPrice) * Number(quantity)));
  const serviceAmount = includesService ? round2(base * serviceRate) : 0;
  const totalAmount = round2(base + serviceAmount);
  return { baseAmount: base, serviceAmount, totalAmount, includesService };
}
