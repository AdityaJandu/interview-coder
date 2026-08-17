// components/shared/LoadingText.tsx
import React from "react"

export const LoadingText = ({ text }: { text: string }) => (
    <div className="mt-4 flex">
        <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
            {text}
        </p>
    </div>
)