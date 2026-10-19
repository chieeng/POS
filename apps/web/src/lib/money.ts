/** Pesos with centavos, the way the store writes them: "₱1,250.00". */
export const formatPeso = (amount: number) =>
  `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
