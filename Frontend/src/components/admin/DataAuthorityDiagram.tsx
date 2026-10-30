/** Vector diagram of DevHQ's three kinds of information: owned, synchronized and derived. */
export function DataAuthorityDiagram() {
  return (
    <svg
      viewBox="0 0 720 190"
      className="h-auto w-full min-w-[600px]"
      role="img"
      aria-label="Source-of-truth data and synchronized data combine into derived insights"
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill="#B9B9B2" />
        </marker>
      </defs>

      <g>
        <rect x="10" y="14" width="210" height="72" rx="12" fill="#FFFFFF" stroke="#D4D4CE" />
        <circle cx="34" cy="38" r="8" fill="#15171C" />
        <text
          x="50"
          y="42"
          fontSize="13"
          fontWeight="600"
          fill="#15171C"
          fontFamily="Inter, sans-serif"
        >
          Source of truth
        </text>
        <text x="26" y="64" fontSize="11" fill="#5C6270" fontFamily="Inter, sans-serif">
          Tasks · memberships · decisions
        </text>
        <text x="26" y="78" fontSize="10" fill="#8B909A" fontFamily="Inter, sans-serif">
          Owned and edited in DevHQ
        </text>
      </g>

      <g>
        <rect
          x="10"
          y="104"
          width="210"
          height="72"
          rx="12"
          fill="#FFFFFF"
          stroke="#D4D4CE"
          strokeDasharray="5 4"
        />
        <path
          d="M27 128a8 8 0 0 1 14-4M41 132a8 8 0 0 1-14 4"
          stroke="#4F46E5"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        <text
          x="50"
          y="132"
          fontSize="13"
          fontWeight="600"
          fill="#15171C"
          fontFamily="Inter, sans-serif"
        >
          Synchronized
        </text>
        <text x="26" y="154" fontSize="11" fill="#5C6270" fontFamily="Inter, sans-serif">
          PRs · CI · deploy events · uptime
        </text>
        <text x="26" y="168" fontSize="10" fill="#8B909A" fontFamily="Inter, sans-serif">
          Read-only, provider is authoritative
        </text>
      </g>

      <path
        d="M220 50 C 290 50, 290 95, 330 95"
        stroke="#B9B9B2"
        strokeWidth="1.5"
        fill="none"
        markerEnd="url(#arrow)"
      />
      <path
        d="M220 140 C 290 140, 290 95, 330 95"
        stroke="#B9B9B2"
        strokeWidth="1.5"
        fill="none"
        markerEnd="url(#arrow)"
      />

      <g>
        <rect x="334" y="55" width="150" height="80" rx="14" fill="#15171C" />
        <text
          x="409"
          y="88"
          textAnchor="middle"
          fontSize="13"
          fontWeight="600"
          fill="#FFFFFF"
          fontFamily="Inter, sans-serif"
        >
          DevHQ model
        </text>
        <text
          x="409"
          y="106"
          textAnchor="middle"
          fontSize="10.5"
          fill="#A5B4FC"
          fontFamily="Inter, sans-serif"
        >
          Linked entities
        </text>
        <circle cx="372" cy="120" r="3" fill="#A5B4FC" />
        <circle cx="390" cy="120" r="3" fill="#A5B4FC" />
        <circle cx="409" cy="120" r="3" fill="#FFFFFF" />
        <circle cx="428" cy="120" r="3" fill="#A5B4FC" />
        <circle cx="446" cy="120" r="3" fill="#A5B4FC" />
      </g>

      <path d="M484 95 H 508" stroke="#B9B9B2" strokeWidth="1.5" markerEnd="url(#arrow)" />

      <g>
        <rect x="512" y="44" width="198" height="102" rx="12" fill="#EEEEFD" stroke="#C7C4F7" />
        <path d="M530 70l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6-4.5-4 6-1z" fill="#4F46E5" />
        <text
          x="546"
          y="76"
          fontSize="13"
          fontWeight="600"
          fill="#3730A3"
          fontFamily="Inter, sans-serif"
        >
          Derived insights
        </text>
        <text x="528" y="100" fontSize="11" fill="#3730A3" fontFamily="Inter, sans-serif">
          Product health · lead time
        </text>
        <text x="528" y="116" fontSize="11" fill="#3730A3" fontFamily="Inter, sans-serif">
          Review load · deploy ↔ incident
        </text>
        <text x="528" y="134" fontSize="10" fill="#6366F1" fontFamily="Inter, sans-serif">
          Recomputed, never hand-entered
        </text>
      </g>
    </svg>
  );
}
