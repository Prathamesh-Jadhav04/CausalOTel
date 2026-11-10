#pragma once

#include <vector>
#include <algorithm>
#include <cstdint>

namespace causalotel {

struct Interval {
    int64_t start;
    int64_t end;

    bool operator<(const Interval& other) const {
        if (start != other.start) return start < other.start;
        return end < other.end;
    }
};

struct SweepLineResult {
    int64_t parentDuration;
    int64_t childUnionDuration;
    int64_t selfTime;
    std::vector<Interval> mergedIntervals;
};

/**
 * Clips child intervals to parent bounds and computes the Sweep-Line Interval Union
 * in O(N log N) time, calculating exact parent self-time.
 */
class SweepLineCalculator {
public:
    static SweepLineResult calculate(const Interval& parent, const std::vector<Interval>& children) {
        SweepLineResult result{};
        int64_t parentStart = parent.start;
        int64_t parentEnd = parent.end;

        if (parentEnd < parentStart) {
            std::swap(parentStart, parentEnd);
        }

        result.parentDuration = parentEnd - parentStart;

        // 1. Clip child intervals to parent bounds [parentStart, parentEnd]
        std::vector<Interval> clipped;
        clipped.reserve(children.size());

        for (const auto& child : children) {
            int64_t cs = child.start;
            int64_t ce = child.end;
            if (ce < cs) std::swap(cs, ce);

            int64_t clippedStart = std::max(parentStart, cs);
            int64_t clippedEnd = std::min(parentEnd, ce);

            // Keep only non-degenerate positive intervals
            if (clippedStart < clippedEnd) {
                clipped.push_back({clippedStart, clippedEnd});
            }
        }

        if (clipped.empty()) {
            result.childUnionDuration = 0;
            result.selfTime = result.parentDuration;
            return result;
        }

        // 2. Sort intervals by start time ascending
        std::sort(clipped.begin(), clipped.end());

        // 3. Sweep-Line Union (merge overlapping or adjacent intervals)
        std::vector<Interval> merged;
        Interval current = clipped[0];

        for (size_t i = 1; i < clipped.size(); ++i) {
            const auto& next = clipped[i];
            if (next.start <= current.end) {
                // Overlapping or contiguous interval -> extend current
                current.end = std::max(current.end, next.end);
            } else {
                // Disjoint interval -> push completed interval and start new
                merged.push_back(current);
                current = next;
            }
        }
        merged.push_back(current);

        // 4. Calculate total child union duration
        int64_t totalChildUnion = 0;
        for (const auto& m : merged) {
            totalChildUnion += (m.end - m.start);
        }

        result.childUnionDuration = totalChildUnion;
        result.selfTime = std::max<int64_t>(0, result.parentDuration - totalChildUnion);
        result.mergedIntervals = std::move(merged);

        return result;
    }
};

} // namespace causalotel
