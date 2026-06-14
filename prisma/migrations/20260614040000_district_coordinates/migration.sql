-- District centroid coordinates (approx) for the Leadership context-fairness
-- travel-burden model. Nullable + additive.
ALTER TABLE "District" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;
