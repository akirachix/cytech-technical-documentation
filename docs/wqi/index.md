# Water Quality Index (WQI)

## Overview

The Water Quality Index (WQI) provides a way to summarize water-quality measurements into an overall status. In AquaTrace, it helps operators interpret monitoring data and identify conditions that may require closer investigation.

The supplied data model associates WQI information with sensor readings and defines five status labels: Excellent, Good, Regular, Poor, and Very poor.

## Measurements and Weighting

The proposed calculation uses pH, temperature, turbidity, and electrical conductivity. Each parameter contributes to the overall result according to its configured weight.

The WQI_Weights entity is intended to store these weights. The supplied design specifies that the weights for a rule version must total 100. The exact calculation formula, parameter thresholds, and boundaries between status categories have not yet been verified.

## Validation and Reliability

Only validated sensor readings should be used for WQI calculations. Rejected messages, duplicate messages, and measurements that fail validation must not influence the result.

The calculation should use clearly defined rules so that a reported status can be interpreted consistently. Missing measurements and sensor faults need explicit handling; they should not silently produce a misleading result.

## Rule Versions and Traceability

WQI weights and calculation rules should be versioned so that results can be interpreted using the rules that produced them. Changes to thresholds, weights, or status boundaries should be documented and validated before use.

The supplied model mentions a rule-version reference for WQI_Weights, but the corresponding field and rule-version entity are not fully defined. Confirm this relationship against the database models and migrations.

## Items to Verify

Before documenting the calculation as implemented, confirm the formula, normalization method, configured weights, status boundaries, treatment of missing values, and relationship between each reading and its rule version.

The supplied model also allows `wqi_score` to be null while requiring `wqi_status`. Confirm how the application handles that combination.

These details should be confirmed from the implementation or approved project specification rather than inferred.
