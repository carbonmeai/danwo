import { styled } from "@danwo/ui/jsx"

import type { IconProps } from "../icons/types"

export const Message = styled((props: IconProps) => {
  const { className = "", size, width, height, ...restProps } = props

  return (
    <svg
      className={`empty-state-illustration ${className}`}
      fill="none"
      height={size || height || 80}
      viewBox="0 0 80 80"
      width={size || width || 80}
      xmlns="http://www.w3.org/2000/svg"
      {...restProps}
    >
      <g filter="url(#filter0_d_403_37901)">
        <path
          d="M61.5668 56.1L62.8668 66.6333C63.2001 69.3999 60.2335 71.3332 57.8668 69.8999L43.9001 61.5999C42.3668 61.5999 40.8668 61.5 39.4002 61.3C41.8668 58.4 43.3335 54.7332 43.3335 50.7666C43.3335 41.2999 35.1335 33.6334 25.0001 33.6334C21.1335 33.6334 17.5668 34.7333 14.6002 36.6666C14.5002 35.8333 14.4668 34.9999 14.4668 34.1333C14.4668 18.9666 27.6335 6.66663 43.9001 6.66663C60.1668 6.66663 73.3335 18.9666 73.3335 34.1333C73.3335 43.1333 68.7001 51.1 61.5668 56.1Z"
          fill="transparent"
        />
        <path
          d="M61.5668 56.1L62.8668 66.6333C63.2001 69.3999 60.2335 71.3332 57.8668 69.8999L43.9001 61.5999C42.3668 61.5999 40.8668 61.5 39.4002 61.3C41.8668 58.4 43.3335 54.7332 43.3335 50.7666C43.3335 41.2999 35.1335 33.6334 25.0001 33.6334C21.1335 33.6334 17.5668 34.7333 14.6002 36.6666C14.5002 35.8333 14.4668 34.9999 14.4668 34.1333C14.4668 18.9666 27.6335 6.66663 43.9001 6.66663C60.1668 6.66663 73.3335 18.9666 73.3335 34.1333C73.3335 43.1333 68.7001 51.1 61.5668 56.1Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </g>
      <g filter="url(#filter1_d_403_37901)">
        <path
          d="M43.3327 50.7666C43.3327 54.7333 41.866 58.4 39.3994 61.3C36.0994 65.3 30.866 67.8666 24.9993 67.8666L16.2993 73.0332C14.8327 73.9332 12.966 72.7 13.166 71L13.9993 64.4334C9.53267 61.3334 6.66602 56.3666 6.66602 50.7666C6.66602 44.8999 9.79937 39.7333 14.5994 36.6667C17.566 34.7333 21.1327 33.6334 24.9993 33.6334C35.1327 33.6334 43.3327 41.2999 43.3327 50.7666Z"
          fill="transparent"
        />
        <path
          d="M43.3327 50.7666C43.3327 54.7333 41.866 58.4 39.3994 61.3C36.0994 65.3 30.866 67.8666 24.9993 67.8666L16.2993 73.0332C14.8327 73.9332 12.966 72.7 13.166 71L13.9993 64.4334C9.53267 61.3334 6.66602 56.3666 6.66602 50.7666C6.66602 44.8999 9.79937 39.7333 14.5994 36.6667C17.566 34.7333 21.1327 33.6334 24.9993 33.6334C35.1327 33.6334 43.3327 41.2999 43.3327 50.7666Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </g>
      <path
        d="M42 27H50"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
      <path
        d="M42.332 35H58.9987"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
      <path
        d="M20 50H28"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
    </svg>
  )
})
