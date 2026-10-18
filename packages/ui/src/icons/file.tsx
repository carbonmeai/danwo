import { styled } from "@danwo/ui/jsx"
import type { SVGProps } from "react"

import excel from "./file-marks/excel.svg"
import html from "./file-marks/html.svg"
import json from "./file-marks/json.svg"
import markdownDark from "./file-marks/markdown-dark.svg"
import markdown from "./file-marks/markdown.svg"
import pdf from "./file-marks/pdf.svg"
import powerpoint from "./file-marks/powerpoint.svg"
import word from "./file-marks/word.svg"
import xml from "./file-marks/xml.svg"
import zip from "./file-marks/zip.svg"

export type TFileIconProps = SVGProps<SVGSVGElement> & {
  size?: number
  isConferencing?: boolean
}

export const FileIcons = {
  csv: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        fill="none"
        height={size}
        viewBox="0 0 40 40"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#079455" />
        <path d="m24 0 12 12h-8a4 4 0 0 1-4-4z" fill="#fff" opacity=".3" />
        <path
          d="M16.645 27.746h-1.4a1.4 1.4 0 0 0-.156-.482 1.2 1.2 0 0 0-.304-.365 1.3 1.3 0 0 0-.428-.23 1.6 1.6 0 0 0-.52-.08q-.51 0-.886.253-.378.25-.585.728-.208.476-.208 1.157 0 .7.208 1.176.21.477.588.72.377.242.872.242.278 0 .515-.073.24-.074.425-.214.186-.144.307-.349.124-.204.172-.466l1.4.006q-.054.45-.271.87a2.6 2.6 0 0 1-.579.744q-.36.326-.863.518a3.2 3.2 0 0 1-1.128.189 3.1 3.1 0 0 1-1.566-.397 2.8 2.8 0 0 1-1.087-1.147q-.396-.75-.396-1.819 0-1.07.403-1.822.402-.75 1.093-1.144.69-.396 1.553-.396.569 0 1.055.16.489.16.866.466a2.4 2.4 0 0 1 .614.745q.24.44.306 1.01m4.544-.409a.8.8 0 0 0-.33-.6q-.29-.215-.79-.215-.338 0-.571.096a.8.8 0 0 0-.358.259.62.62 0 0 0-.122.377.54.54 0 0 0 .074.307.8.8 0 0 0 .227.227q.144.092.332.163.189.066.403.115l.588.14q.428.096.786.256t.62.393.406.55q.147.316.15.725a1.8 1.8 0 0 1-.306 1.042q-.3.439-.87.681-.566.24-1.364.24-.794 0-1.381-.243a2 2 0 0 1-.914-.72q-.326-.479-.342-1.185h1.339q.022.33.189.55.169.217.45.329.285.108.642.108.352 0 .611-.102a.94.94 0 0 0 .406-.284.66.66 0 0 0 .144-.419.54.54 0 0 0-.131-.37 1 1 0 0 0-.378-.256 4 4 0 0 0-.604-.192l-.712-.179q-.828-.201-1.307-.63-.48-.428-.477-1.153a1.7 1.7 0 0 1 .317-1.04q.323-.443.885-.693t1.279-.249q.728 0 1.272.25.546.249.85.693.303.445.313 1.029zm3.529-1.883 1.582 4.974h.06l1.586-4.974h1.534L27.223 32H25.44l-2.26-6.546z"
          fill="#fff"
        />
      </svg>
    )
  },
  document: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        fill="none"
        height={size}
        viewBox="0 0 40 40"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#155EEF" />
        <path d="m24 0 12 12h-8a4 4 0 0 1-4-4z" fill="#fff" opacity=".3" />
        <path
          d="M12.8 20h14.4m-14.4 3.2h14.4m-14.4 3.2h14.4m-14.4 3.2H24"
          stroke="#fff"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    )
  },
  docx: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        {...props}
        fill="#FFF"
        height={size}
        strokeMiterlimit="10"
        strokeWidth="2"
        viewBox="0 0 96 96"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          stroke="#979593"
          d="M67.1716 7H27c-1.1046 0-2 .8954-2 2v78c0 1.1046.8954 2 2 2h58c1.1046 0 2-.8954 2-2V26.8284c0-.5304-.2107-1.0391-.5858-1.4142L68.5858 7.5858C68.2107 7.2107 67.702 7 67.1716 7z"
        />
        <path fill="none" stroke="#979593" d="M67 7v18c0 1.1046.8954 2 2 2h18" />
        <path
          fill="#C8C6C4"
          d="M79 61H48v-2h31c.5523 0 1 .4477 1 1s-.4477 1-1 1zm0-6H48v-2h31c.5523 0 1 .4477 1 1s-.4477 1-1 1zm0-6H48v-2h31c.5523 0 1 .4477 1 1s-.4477 1-1 1zm0-6H48v-2h31c.5523 0 1 .4477 1 1s-.4477 1-1 1zm0 24H48v-2h31c.5523 0 1 .4477 1 1s-.4477 1-1 1z"
        />
        <path
          fill="#185ABD"
          d="M12 74h32c2.2091 0 4-1.7909 4-4V38c0-2.2091-1.7909-4-4-4H12c-2.2091 0-4 1.7909-4 4v32c0 2.2091 1.7909 4 4 4z"
        />
        <path d="M21.6245 60.6455c.0661.522.109.9769.1296 1.3657h.0762c.0306-.3685.0889-.8129.1751-1.3349.0862-.5211.1703-.961.2517-1.319L25.7911 44h4.5702l3.6562 15.1272c.183.7468.3353 1.6973.457 2.8532h.0608c.0508-.7979.1777-1.7184.3809-2.7615L37.8413 44H42l-5.1183 22h-4.86l-3.4885-14.5744c-.1016-.4197-.2158-.9663-.3428-1.6417-.127-.6745-.2057-1.1656-.236-1.4724h-.0608c-.0407.358-.1195.8896-.2364 1.595-.1169.7062-.211 1.2273-.2819 1.565L24.1 66h-4.9357L14 44h4.2349l3.1843 15.3882c.0709.3165.1392.7362.2053 1.2573z" />
      </svg>
    )
  },
  folder: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 1004 854"
        fill="none"
        {...props}
      >
        <g filter="url(#filter0_ddd_1_3)">
          <mask id="mask0_1_3" maskUnits="userSpaceOnUse" x="32" y="16" width="940" height="790">
            <path
              d="M147.2 806H856.8C897.124 806 917.286 806 932.687 798.152C946.235 791.25 957.25 780.235 964.152 766.687C972 751.286 972 731.124 972 690.8V205.2C972 164.876 972 144.714 964.152 129.313C957.25 115.765 946.235 104.75 932.687 97.8475C917.286 90 897.124 90 856.8 90H467.5C446 90 418.5 88 391.5 67.5C364.5 47 387.5 64.5 359 42.5C330.5 20.5 315.966 16 291 16H147.2C106.876 16 86.7143 16 71.3127 23.8475C57.765 30.7504 46.7504 41.765 39.8475 55.3127C32 70.7143 32 90.8762 32 131.2V690.8C32 731.124 32 751.286 39.8475 766.687C46.7504 780.235 57.765 791.25 71.3127 798.152C86.7143 806 106.876 806 147.2 806Z"
              fill="url(#paint0_linear_1_3)"
            />
            <path
              d="M147.2 19H291C303.287 19 312.766 20.1074 322.62 23.8086C332.527 27.5297 343.01 33.9467 357.167 44.875C385.538 66.7753 362.72 49.4161 389.686 69.8896C417.475 90.9887 445.787 93 467.5 93H856.8C877.011 93 891.989 93.0021 903.845 93.9707C915.665 94.9365 924.118 96.8482 931.325 100.521C944.308 107.136 954.864 117.692 961.479 130.675C965.152 137.882 967.064 146.335 968.029 158.155C968.998 170.011 969 184.989 969 205.2V690.8C969 711.011 968.998 725.989 968.029 737.845C967.064 749.665 965.152 758.118 961.479 765.325C954.864 778.308 944.308 788.864 931.325 795.479C924.118 799.152 915.665 801.064 903.845 802.029C891.989 802.998 877.011 803 856.8 803H147.2C126.989 803 112.011 802.998 100.155 802.029C88.3347 801.064 79.8822 799.152 72.6748 795.479C59.6916 788.864 49.1358 778.308 42.5205 765.325C38.8482 758.118 36.9365 749.665 35.9707 737.845C35.0021 725.989 35 711.011 35 690.8V131.2C35 110.989 35.0021 96.0109 35.9707 84.1553C36.9365 72.3347 38.8482 63.8822 42.5205 56.6748C49.1358 43.6916 59.6916 33.1358 72.6748 26.5205C79.8822 22.8482 88.3347 20.9365 100.155 19.9707C112.011 19.0021 126.989 19 147.2 19Z"
              stroke="url(#paint1_linear_1_3)"
              strokeOpacity="0.07"
              strokeWidth="6"
            />
          </mask>
          <g mask="url(#mask0_1_3)">
            <path
              d="M147.2 806H856.8C897.124 806 917.286 806 932.687 798.152C946.235 791.25 957.25 780.235 964.152 766.687C972 751.286 972 731.124 972 690.8V205.2C972 164.876 972 144.714 964.152 129.313C957.25 115.765 946.235 104.75 932.687 97.8475C917.286 90 897.124 90 856.8 90H467.5C446 90 418.5 88 391.5 67.5C364.5 47 387.5 64.5 359 42.5C330.5 20.5 315.966 16 291 16H147.2C106.876 16 86.7143 16 71.3127 23.8475C57.765 30.7504 46.7504 41.765 39.8475 55.3127C32 70.7143 32 90.8762 32 131.2V690.8C32 731.124 32 751.286 39.8475 766.687C46.7504 780.235 57.765 791.25 71.3127 798.152C86.7143 806 106.876 806 147.2 806Z"
              fill="url(#paint2_linear_1_3)"
            />
            <path
              d="M147.2 806H856.8C897.124 806 917.286 806 932.687 798.152C946.235 791.25 957.25 780.235 964.152 766.687C972 751.286 972 731.124 972 690.8V205.2C972 164.876 972 144.714 964.152 129.313C957.25 115.765 946.235 104.75 932.687 97.8475C917.286 90 897.124 90 856.8 90H467.5C446 90 418.5 88 391.5 67.5C364.5 47 387.5 64.5 359 42.5C330.5 20.5 315.966 16 291 16H147.2C106.876 16 86.7143 16 71.3127 23.8475C57.765 30.7504 46.7504 41.765 39.8475 55.3127C32 70.7143 32 90.8762 32 131.2V690.8C32 731.124 32 751.286 39.8475 766.687C46.7504 780.235 57.765 791.25 71.3127 798.152C86.7143 806 106.876 806 147.2 806Z"
              fill="url(#pattern0_1_3)"
              fillOpacity="0.12"
            />
            <path
              d="M147.2 19H291C303.287 19 312.766 20.1074 322.62 23.8086C332.527 27.5297 343.01 33.9467 357.167 44.875C385.538 66.7753 362.72 49.4161 389.686 69.8896C417.475 90.9887 445.787 93 467.5 93H856.8C877.011 93 891.989 93.0021 903.845 93.9707C915.665 94.9365 924.118 96.8482 931.325 100.521C944.308 107.136 954.864 117.692 961.479 130.675C965.152 137.882 967.064 146.335 968.029 158.155C968.998 170.011 969 184.989 969 205.2V690.8C969 711.011 968.998 725.989 968.029 737.845C967.064 749.665 965.152 758.118 961.479 765.325C954.864 778.308 944.308 788.864 931.325 795.479C924.118 799.152 915.665 801.064 903.845 802.029C891.989 802.998 877.011 803 856.8 803H147.2C126.989 803 112.011 802.998 100.155 802.029C88.3347 801.064 79.8822 799.152 72.6748 795.479C59.6916 788.864 49.1358 778.308 42.5205 765.325C38.8482 758.118 36.9365 749.665 35.9707 737.845C35.0021 725.989 35 711.011 35 690.8V131.2C35 110.989 35.0021 96.0109 35.9707 84.1553C36.9365 72.3347 38.8482 63.8822 42.5205 56.6748C49.1358 43.6916 59.6916 33.1358 72.6748 26.5205C79.8822 22.8482 88.3347 20.9365 100.155 19.9707C112.011 19.0021 126.989 19 147.2 19Z"
              stroke="url(#paint3_linear_1_3)"
              strokeOpacity="0.07"
              strokeWidth="6"
            />
            <g filter="url(#filter1_dii_1_3)">
              <rect
                x="32"
                y="150"
                width="940"
                height="656"
                rx="72"
                fill="url(#paint4_linear_1_3)"
              />
              <rect
                x="32"
                y="150"
                width="940"
                height="656"
                rx="72"
                fill="url(#pattern1_1_3)"
                fillOpacity="0.1"
              />
            </g>
            <g filter="url(#filter2_di_1_3)">
              <rect
                x="32"
                y="708"
                width="940"
                height="18"
                fill="white"
                fillOpacity="0.1"
                shapeRendering="crispEdges"
              />
            </g>
            <g filter="url(#filter3_di_1_3)">
              <rect
                x="32"
                y="745"
                width="940"
                height="18"
                fill="white"
                fillOpacity="0.1"
                shapeRendering="crispEdges"
              />
            </g>
          </g>
        </g>
        <defs>
          <filter
            id="filter0_ddd_1_3"
            x="0"
            y="0"
            width="1004"
            height="854"
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
            <feOffset dy="16" />
            <feGaussianBlur stdDeviation="16" />
            <feComposite in2="hardAlpha" operator="out" />
            <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0" />
            <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1_3" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
            <feOffset dy="12" />
            <feGaussianBlur stdDeviation="12" />
            <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.21 0" />
            <feBlend mode="normal" in2="effect1_dropShadow_1_3" result="effect2_dropShadow_1_3" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
            <feOffset dy="8" />
            <feGaussianBlur stdDeviation="8" />
            <feComposite in2="hardAlpha" operator="out" />
            <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.3 0" />
            <feBlend mode="normal" in2="effect2_dropShadow_1_3" result="effect3_dropShadow_1_3" />
            <feBlend mode="normal" in="SourceGraphic" in2="effect3_dropShadow_1_3" result="shape" />
          </filter>
          <filter
            id="filter1_dii_1_3"
            x="-32"
            y="70"
            width="1068"
            height="784"
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
            <feOffset dy="-16" />
            <feGaussianBlur stdDeviation="32" />
            <feComposite in2="hardAlpha" operator="out" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0.517647 0 0 0 0 0.803922 0 0 0 0.5 0"
            />
            <feBlend mode="multiply" in2="BackgroundImageFix" result="effect1_dropShadow_1_3" />
            <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1_3" result="shape" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
            <feOffset dy="-32" />
            <feGaussianBlur stdDeviation="64" />
            <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.0466319 0 0 0 0 0.440508 0 0 0 0 0.658333 0 0 0 0.3 0"
            />
            <feBlend mode="multiply" in2="shape" result="effect2_innerShadow_1_3" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
            <feOffset dy="6" />
            <feGaussianBlur stdDeviation="3" />
            <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
            <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.2 0" />
            <feBlend mode="normal" in2="effect2_innerShadow_1_3" result="effect3_innerShadow_1_3" />
          </filter>
          <filter
            id="filter2_di_1_3"
            x="26"
            y="702"
            width="952"
            height="36"
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
            <feOffset dy="6" />
            <feGaussianBlur stdDeviation="3" />
            <feComposite in2="hardAlpha" operator="out" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0.517647 0 0 0 0 0.803922 0 0 0 0.1 0"
            />
            <feBlend mode="multiply" in2="BackgroundImageFix" result="effect1_dropShadow_1_3" />
            <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1_3" result="shape" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
            <feOffset dy="-6" />
            <feGaussianBlur stdDeviation="3" />
            <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0.517647 0 0 0 0 0.803922 0 0 0 0.1 0"
            />
            <feBlend mode="multiply" in2="shape" result="effect2_innerShadow_1_3" />
          </filter>
          <filter
            id="filter3_di_1_3"
            x="26"
            y="739"
            width="952"
            height="36"
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
            <feOffset dy="6" />
            <feGaussianBlur stdDeviation="3" />
            <feComposite in2="hardAlpha" operator="out" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0.517647 0 0 0 0 0.803922 0 0 0 0.1 0"
            />
            <feBlend mode="multiply" in2="BackgroundImageFix" result="effect1_dropShadow_1_3" />
            <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1_3" result="shape" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
            <feOffset dy="-6" />
            <feGaussianBlur stdDeviation="3" />
            <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0.517647 0 0 0 0 0.803922 0 0 0 0.1 0"
            />
            <feBlend mode="multiply" in2="shape" result="effect2_innerShadow_1_3" />
          </filter>
          <linearGradient
            id="paint0_linear_1_3"
            x1="502"
            y1="64"
            x2="502"
            y2="854"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#5BB1E0" />
            <stop offset="0.229272" stopColor="#0591DE" />
          </linearGradient>
          <linearGradient
            id="paint1_linear_1_3"
            x1="502"
            y1="136.5"
            x2="502"
            y2="202.5"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#003C5C" />
            <stop offset="1" stopColor="#003C5C" stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id="paint2_linear_1_3"
            x1="502"
            y1="16"
            x2="502"
            y2="854"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#57ADDB" />
            <stop offset="0.229272" stopColor="#098DD6" />
          </linearGradient>
          <linearGradient
            id="paint3_linear_1_3"
            x1="502"
            y1="136.5"
            x2="502"
            y2="202.5"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#003C5C" />
            <stop offset="1" stopColor="#003C5C" stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id="paint4_linear_1_3"
            x1="502"
            y1="150"
            x2="502"
            y2="806"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#73D7FF" />
            <stop offset="1" stopColor="#6BCBF3" />
          </linearGradient>
        </defs>
      </svg>
    )
  },
  html: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        fill="none"
        height={size}
        viewBox="0 0 40 40"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#444CE7" />
        <path d="m24 0 12 12h-8a4 4 0 0 1-4-4z" fill="#fff" opacity=".3" />
        <path
          d="M7.535 32v-6.546h1.384v2.701h2.809v-2.7h1.38V32h-1.38v-2.704h-2.81V32zM14 26.596v-1.142h5.376v1.142h-2.004V32h-1.368v-5.404zm6.261-1.142h1.707l1.802 4.398h.077l1.803-4.398h1.706V32h-1.342v-4.26h-.054l-1.694 4.228h-.914l-1.694-4.244h-.054V32H20.26zM28.497 32v-6.546h1.384v5.405h2.806V32z"
          fill="#fff"
        />
      </svg>
    )
  },
  image: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        fill="none"
        height={size}
        viewBox="0 0 40 40"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#7F56D9" />
        <path d="m24 0 12 12h-8a4 4 0 0 1-4-4z" fill="#fff" opacity=".3" />
        <path
          d="M13.15 25.455V32h-1.383v-6.546zm1.14 0h1.706l1.802 4.397h.077l1.803-4.398h1.706V32h-1.342v-4.26h-.054l-1.694 4.228h-.914l-1.694-4.244h-.055V32H14.29zm12.575 2.115a1.4 1.4 0 0 0-.189-.412 1.28 1.28 0 0 0-.694-.502 1.7 1.7 0 0 0-.488-.067q-.502 0-.883.25a1.63 1.63 0 0 0-.588.725q-.21.472-.21 1.157 0 .684.207 1.163.209.48.588.732a1.6 1.6 0 0 0 .898.25q.47 0 .802-.167a1.2 1.2 0 0 0 .512-.476q.18-.306.179-.726l.281.042h-1.687v-1.042h2.739v.825q0 .863-.365 1.483a2.5 2.5 0 0 1-1.003.952q-.639.333-1.464.332-.921 0-1.617-.405a2.8 2.8 0 0 1-1.087-1.16q-.387-.755-.387-1.79 0-.796.23-1.42.234-.625.652-1.06.42-.434.975-.662.557-.227 1.205-.227.556 0 1.036.163.48.16.85.454.375.295.61.7.238.402.304.888z"
          fill="#fff"
        />
      </svg>
    )
  },
  json: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        fill="none"
        height={size}
        viewBox="0 0 40 40"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#444CE7" />
        <path d="m24 0 12 12h-8a4 4 0 0 1-4-4z" fill="#fff" opacity=".3" />
        <path
          d="M10.845 25.455h1.368v4.564q0 .632-.284 1.099a1.9 1.9 0 0 1-.783.719q-.503.253-1.167.253-.591 0-1.074-.208a1.7 1.7 0 0 1-.76-.64q-.281-.43-.278-1.083h1.377q.006.259.106.444a.7.7 0 0 0 .278.282q.179.095.422.095.255 0 .431-.108a.7.7 0 0 0 .272-.326q.092-.215.092-.527zm6.063 1.882a.8.8 0 0 0-.329-.6q-.29-.215-.79-.215-.338 0-.571.096a.8.8 0 0 0-.358.259.62.62 0 0 0-.122.377q-.006.176.074.307a.8.8 0 0 0 .227.227q.143.092.332.163.189.066.403.115l.588.14q.428.096.786.256t.62.393.406.55q.147.316.15.725a1.8 1.8 0 0 1-.307 1.042q-.3.439-.87.681-.564.24-1.364.24-.792 0-1.38-.243a2 2 0 0 1-.915-.72q-.325-.479-.341-1.185h1.339q.022.33.188.55.17.217.45.329.285.108.643.108.352 0 .61-.102a.94.94 0 0 0 .407-.284.66.66 0 0 0 .143-.419.54.54 0 0 0-.13-.37 1 1 0 0 0-.378-.256 4 4 0 0 0-.604-.192l-.713-.179q-.827-.201-1.307-.63-.48-.428-.476-1.153a1.7 1.7 0 0 1 .316-1.04q.323-.443.886-.693t1.278-.249q.729 0 1.272.25.547.249.85.693.304.445.314 1.029zm8.362 1.39q0 1.07-.406 1.822-.402.75-1.1 1.147a3.1 3.1 0 0 1-1.56.393 3.1 3.1 0 0 1-1.565-.396 2.8 2.8 0 0 1-1.096-1.147q-.403-.75-.403-1.819 0-1.07.403-1.822.402-.75 1.096-1.144a3.1 3.1 0 0 1 1.566-.396q.866 0 1.56.396.696.393 1.099 1.145.405.75.406 1.821m-1.403 0q0-.693-.208-1.17a1.6 1.6 0 0 0-.578-.722 1.56 1.56 0 0 0-.876-.246q-.503 0-.876.246-.374.246-.582.723-.204.476-.204 1.17 0 .692.204 1.169.208.477.582.722.374.246.876.246.501 0 .876-.246.374-.245.578-.722.208-.476.208-1.17m7.903-3.273V32h-1.196l-2.847-4.12h-.048V32h-1.384v-6.546h1.214l2.826 4.117h.057v-4.117z"
          fill="#fff"
        />
      </svg>
    )
  },
  pdf: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        {...props}
        fill="none"
        height={size}
        viewBox="0 0 500 615"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M0 66C0 29.5492 29.5492 0 66 0H343.068C360.418 0 377.071 6.83216 389.422 19.0179L480.354 108.734C492.924 121.136 500 138.058 500 155.716V549C500 585.451 470.451 615 434 615H66C29.5492 615 0 585.451 0 549V66Z"
          fill="white"
        />
        <path
          d="M219.583 137.917C220.905 113.959 250.417 111.042 258.125 137.917C264.292 159.417 254.375 193.959 248.062 218.623C254.375 233.125 274.999 260 287.291 271.875C328.333 265.625 351.458 266.322 366.666 273.542C387.291 283.334 382.916 307.424 362.916 309.375C345.833 311.042 320.624 309.374 284.791 279.583C275.485 280.833 247.749 286.208 214.583 297.708C201.875 318.125 184.166 346.049 169.166 358.125C144.583 377.916 126.041 371.458 120.833 360.625C113.75 341.458 142.5 323.541 194.791 297.708C203.055 281.319 222.124 240.333 232.291 207.5C227.847 196.875 217.916 168.125 219.583 137.917ZM187.708 308.958C116.458 339.704 119.792 360.417 133.125 362.5C146.458 364.583 162.917 347.708 187.708 308.958ZM362.083 290.625C361.25 271.042 331.25 271.041 292.083 277.708C337.708 310.208 362.083 304.375 362.083 290.625ZM244.583 226.458C233.583 258.958 222.916 281.806 218.958 289.167C248.625 280 272.152 275.069 280.208 273.75C263.708 255.083 249.583 234.444 244.583 226.458ZM236.041 197.083C253.333 141.875 247.5 124.375 234.375 126.25C220.625 128.542 222.5 167.708 236.041 197.083Z"
          fill="#FF2116"
        />
        <path
          d="M0 549V66C4.12327e-06 29.5492 29.5492 0 66 0H343.067L343.881 0.00488281C360.938 0.21482 377.264 7.02236 389.422 19.0176L480.354 108.734C492.924 121.136 500 138.059 500 155.717V549L499.994 549.853C499.538 585.91 470.166 615 434 615V597C460.51 597 482 575.51 482 549V155.717C482 143.075 477.014 130.952 468.138 121.973L467.712 121.548L376.779 31.8311C367.797 22.9688 355.686 18 343.067 18H66C39.4903 18 18 39.4903 18 66V549C18 575.51 39.4903 597 66 597V615L65.1465 614.994C29.089 614.537 0 585.166 0 549ZM434 597V615H66V597H434Z"
          fill="#FF2116"
        />
        <path
          d="M324.585 432.578V525H307.129V432.578H324.585ZM361.846 472.505V486.279H320.015V472.505H361.846ZM366.733 432.578V446.353H320.015V432.578H366.733Z"
          fill="black"
        />
        <path
          d="M250.063 525H230.132L230.259 511.289H250.063C255.438 511.289 259.945 510.104 263.584 507.734C267.223 505.322 269.974 501.873 271.836 497.388C273.698 492.86 274.629 487.443 274.629 481.138V476.377C274.629 471.51 274.1 467.215 273.042 463.491C271.984 459.767 270.418 456.636 268.345 454.097C266.313 451.558 263.796 449.632 260.791 448.32C257.786 447.008 254.338 446.353 250.444 446.353H229.751V432.578H250.444C256.623 432.578 262.251 433.615 267.329 435.688C272.45 437.762 276.872 440.745 280.596 444.639C284.362 448.49 287.24 453.102 289.229 458.477C291.26 463.851 292.275 469.86 292.275 476.504V481.138C292.275 487.739 291.26 493.748 289.229 499.165C287.24 504.539 284.362 509.152 280.596 513.003C276.872 516.854 272.428 519.816 267.266 521.89C262.103 523.963 256.369 525 250.063 525ZM239.907 432.578V525H222.451V432.578H239.907Z"
          fill="black"
        />
        <path
          d="M174.59 491.294H150.786V477.583H174.59C178.483 477.583 181.636 476.948 184.048 475.679C186.502 474.367 188.301 472.59 189.443 470.347C190.586 468.062 191.157 465.459 191.157 462.539C191.157 459.704 190.586 457.059 189.443 454.604C188.301 452.15 186.502 450.161 184.048 448.638C181.636 447.114 178.483 446.353 174.59 446.353H156.499V525H139.043V432.578H174.59C181.784 432.578 187.92 433.869 192.998 436.45C198.118 438.989 202.012 442.523 204.678 447.051C207.386 451.536 208.74 456.657 208.74 462.412C208.74 468.379 207.386 473.521 204.678 477.837C202.012 482.153 198.118 485.475 192.998 487.803C187.92 490.13 181.784 491.294 174.59 491.294Z"
          fill="black"
        />
      </svg>
    )
  },
  ppt: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        fill="none"
        height={size}
        viewBox="0 0 40 40"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#7F56D9" />
        <path d="m24 0 12 12h-8a4 4 0 0 1-4-4z" fill="#fff" opacity=".3" />
        <path
          d="M10.923 32v-6.546h2.582q.745 0 1.27.285.523.281.798.783.278.498.278 1.15 0 .653-.281 1.151a1.94 1.94 0 0 1-.815.777q-.53.278-1.285.278h-1.646v-1.11h1.422q.4 0 .659-.137a.9.9 0 0 0 .39-.386 1.2 1.2 0 0 0 .13-.572 1.2 1.2 0 0 0-.13-.57.88.88 0 0 0-.39-.38q-.262-.137-.665-.137h-.933V32zm11.302-6.546V32h-1.196l-2.847-4.12h-.048V32H16.75v-6.546h1.215l2.825 4.117h.057v-4.117zm5.483 2.116a1.4 1.4 0 0 0-.188-.412 1.27 1.27 0 0 0-.694-.502 1.7 1.7 0 0 0-.489-.067q-.501 0-.882.25a1.64 1.64 0 0 0-.588.725q-.21.472-.21 1.157 0 .684.207 1.163.207.48.588.732.38.25.898.25.47 0 .802-.167.336-.169.512-.476.179-.306.179-.726l.28.042h-1.687v-1.042h2.74v.825q0 .863-.365 1.483a2.5 2.5 0 0 1-1.003.952q-.64.333-1.464.332-.921 0-1.617-.405a2.8 2.8 0 0 1-1.087-1.16q-.387-.755-.387-1.79 0-.796.23-1.42a3 3 0 0 1 .652-1.06q.42-.434.975-.662.555-.227 1.205-.227.556 0 1.035.163.48.16.85.454.374.295.611.7.237.402.304.888z"
          fill="#fff"
        />
      </svg>
    )
  },
  /** A slide deck (`.slides`): a line mark in the text colour around it, unlike the coloured format marks. */
  slides: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d="M2 3h20" />
        <path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" />
        <path d="m7 21 5-5 5 5" />
      </svg>
    )
  },
  pptx: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        fill="none"
        height={size}
        viewBox="0 0 40 40"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#E62E05" />
        <path d="m24 0 12 12h-8a4 4 0 0 1-4-4z" fill="#fff" opacity=".3" />
        <path
          d="M8.52 32v-6.546h2.582q.744 0 1.268.285.524.281.8.783.277.498.277 1.15 0 .653-.28 1.151a1.94 1.94 0 0 1-.816.777q-.53.278-1.285.278H9.42v-1.11h1.423q.399 0 .658-.137a.9.9 0 0 0 .39-.386q.13-.25.13-.572 0-.326-.13-.57a.88.88 0 0 0-.39-.38q-.262-.137-.665-.137h-.933V32zm5.826 0v-6.546h2.583q.744 0 1.268.285.524.281.8.783.277.498.277 1.15 0 .653-.28 1.151a1.94 1.94 0 0 1-.816.777q-.53.278-1.285.278h-1.646v-1.11h1.423q.399 0 .658-.137a.9.9 0 0 0 .39-.386 1.2 1.2 0 0 0 .131-.572 1.2 1.2 0 0 0-.131-.57.88.88 0 0 0-.39-.38q-.262-.137-.665-.137h-.933V32zm5.578-5.404v-1.142H25.3v1.142h-2.004V32h-1.368v-5.404zm7.559-1.142 1.32 2.231h.05l1.327-2.23h1.563l-1.997 3.272L31.788 32h-1.592l-1.342-2.234h-.051L27.46 32h-1.585l2.049-3.273-2.01-3.273z"
          fill="#fff"
        />
      </svg>
    )
  },
  spreadsheet: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        fill="none"
        height={size}
        viewBox="0 0 40 40"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#079455" />
        <path d="m24 0 12 12h-8a4 4 0 0 1-4-4z" fill="#fff" opacity=".3" />
        <path
          d="M12.8 24.8h14.4m-14.4 0v-3.2a1.6 1.6 0 0 1 1.6-1.6h3.2m-4.8 4.8V28a1.6 1.6 0 0 0 1.6 1.6h3.2m9.6-4.8V28a1.6 1.6 0 0 1-1.6 1.6h-8m9.6-4.8v-3.2a1.6 1.6 0 0 0-1.6-1.6h-8m0 0v9.6"
          stroke="#fff"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    )
  },
  txt: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        fill="none"
        height={size}
        viewBox="0 0 40 40"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#344054" />
        <path d="m24 0 12 12h-8a4 4 0 0 1-4-4z" fill="#fff" opacity=".3" />
        <path
          d="M11.091 26.596v-1.142h5.376v1.142h-2.004V32h-1.368v-5.404zm7.559-1.142 1.32 2.231h.05l1.327-2.23h1.563l-1.997 3.272L22.955 32h-1.592l-1.342-2.234h-.051L18.627 32h-1.585l2.049-3.273-2.01-3.273zm4.886 1.142v-1.142h5.376v1.142h-2.004V32H25.54v-5.404z"
          fill="#fff"
        />
      </svg>
    )
  },
  xlsx: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        fill="none"
        height={size}
        viewBox="0 0 40 40"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#079455" />
        <path d="m24 0 12 12h-8a4 4 0 0 1-4-4z" fill="#fff" opacity=".3" />
        <path
          d="m9.93 25.455 1.32 2.23h.052l1.326-2.23h1.563l-1.997 3.272L14.236 32h-1.592l-1.342-2.234h-.051L9.909 32H8.323l2.049-3.273-2.01-3.273zM15.068 32v-6.546h1.384v5.405h2.806V32zm8.657-4.663a.8.8 0 0 0-.329-.6q-.29-.215-.79-.215-.338 0-.572.096a.8.8 0 0 0-.358.259.62.62 0 0 0-.12.377q-.007.176.073.307a.8.8 0 0 0 .227.227q.143.092.332.163.189.066.403.115l.588.14q.427.096.786.256.358.16.62.393.262.234.406.55.147.316.15.725a1.8 1.8 0 0 1-.307 1.042q-.3.439-.87.681-.564.24-1.364.24-.793 0-1.38-.243a2 2 0 0 1-.915-.72q-.325-.479-.342-1.185h1.34q.022.33.188.55.17.217.45.329.285.108.643.108.352 0 .61-.102a.94.94 0 0 0 .406-.284.66.66 0 0 0 .144-.419.54.54 0 0 0-.13-.37 1 1 0 0 0-.378-.256 4 4 0 0 0-.604-.192l-.713-.179q-.827-.201-1.307-.63-.48-.428-.476-1.153a1.7 1.7 0 0 1 .316-1.04q.323-.443.886-.693t1.278-.249q.729 0 1.272.25.547.249.85.693.304.445.314 1.029zm3.644-1.883 1.32 2.231h.052l1.326-2.23h1.563l-1.998 3.272L31.674 32h-1.592l-1.343-2.234h-.05L27.345 32H25.76l2.049-3.273-2.01-3.273z"
          fill="#fff"
        />
      </svg>
    )
  },
  xml: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        fill="none"
        height={size}
        viewBox="0 0 40 40"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#444CE7" />
        <path d="m24 0 12 12h-8a4 4 0 0 1-4-4z" fill="#fff" opacity=".3" />
        <path
          d="m11.979 25.455 1.32 2.23h.05l1.327-2.23h1.563l-1.997 3.272L16.284 32h-1.592l-1.342-2.234h-.051L11.956 32h-1.585l2.049-3.273-2.01-3.273zm5.136 0h1.707l1.802 4.397h.077l1.802-4.398h1.707V32h-1.342v-4.26h-.055l-1.694 4.228h-.914l-1.693-4.244h-.055V32h-1.342zM25.35 32v-6.546h1.384v5.405h2.806V32z"
          fill="#fff"
        />
      </svg>
    )
  },
  zip: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        fill="none"
        height={size}
        viewBox="0 0 40 40"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#344054" />
        <path d="m24 0 12 12h-8a4 4 0 0 1-4-4z" fill="#fff" opacity=".3" />
        <path
          d="M13.322 32v-.821l3.267-4.583h-3.273v-1.142h5.011v.822l-3.27 4.583h3.277V32zm7.457-6.546V32h-1.383v-6.546zM21.918 32v-6.546H24.5q.745 0 1.27.285.524.281.798.783.279.498.278 1.15 0 .653-.281 1.151a1.94 1.94 0 0 1-.815.777q-.53.278-1.285.278H22.82v-1.11h1.422q.4 0 .659-.137a.9.9 0 0 0 .39-.386 1.2 1.2 0 0 0 .13-.572 1.2 1.2 0 0 0-.13-.57.88.88 0 0 0-.39-.38q-.262-.137-.665-.137h-.933V32z"
          fill="#fff"
        />
      </svg>
    )
  },
  audio: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        fill="none"
        height={size}
        viewBox="0 0 40 40"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#DD2590" />
        <path d="m24 0 12 12h-8a4 4 0 0 1-4-4z" fill="#fff" opacity=".3" />
        <path
          d="M17 29.5v-9l9-1.75v9M17 29.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0m9-1.75a2 2 0 1 1-4 0 2 2 0 0 1 4 0"
          stroke="#fff"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    )
  },
  video: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        fill="none"
        height={size}
        viewBox="0 0 40 40"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#6938EF" />
        <path d="m24 0 12 12h-8a4 4 0 0 1-4-4z" fill="#fff" opacity=".3" />
        <path
          d="M17 20.6v6.8a.6.6 0 0 0 .9.52l5.9-3.4a.6.6 0 0 0 0-1.04l-5.9-3.4a.6.6 0 0 0-.9.52"
          stroke="#fff"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    )
  },
  /** Any type without a mark of its own. */
  file: ({ size = 14, ...props }: TFileIconProps) => {
    return (
      <svg
        fill="none"
        height={size}
        viewBox="0 0 40 40"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <path d="M4 4a4 4 0 0 1 4-4h16l12 12v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#98A2B3" />
        <path d="m24 0 12 12h-8a4 4 0 0 1-4-4z" fill="#fff" opacity=".3" />
      </svg>
    )
  },
}

export type FileIconKey = keyof typeof FileIcons

/** Formats drawn with their owners' marks (theSVG, see file-marks/README.md); the rest use the drawn marks above. */
const BRAND_MARKS: Partial<Record<FileIconKey | "markdown", { light: string; dark?: string }>> = {
  docx: { light: word },
  document: { light: word },
  xlsx: { light: excel },
  spreadsheet: { light: excel },
  pptx: { light: powerpoint },
  ppt: { light: powerpoint },
  pdf: { light: pdf },
  markdown: { light: markdown, dark: markdownDark },
  json: { light: json },
  html: { light: html },
  xml: { light: xml },
  zip: { light: zip },
}

const MIME_TO_ICON: Record<string, FileIconKey> = {
  "application/json": "json",
  "application/msword": "document",
  "application/pdf": "pdf",
  "application/vnd.ms-excel": "spreadsheet",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/x-ndjson": "json",
  "application/x-yaml": "txt",
  "application/x-zip-compressed": "zip",
  "application/xml": "xml",
  "application/zip": "zip",
  "text/csv": "csv",
  "text/html": "html",
  "text/markdown": "txt",
  "text/plain": "txt",
  "text/xml": "xml",
}

const EXT_TO_ICON: Record<string, FileIconKey> = {
  bmp: "image",
  csv: "csv",
  doc: "document",
  docx: "docx",
  gif: "image",
  htm: "html",
  html: "html",
  ico: "image",
  jpeg: "image",
  jpg: "image",
  json: "json",
  m4a: "audio",
  md: "txt",
  mov: "video",
  mp3: "audio",
  mp4: "video",
  ogg: "audio",
  pdf: "pdf",
  png: "image",
  ppt: "ppt",
  pptx: "pptx",
  svg: "image",
  txt: "txt",
  wav: "audio",
  webm: "video",
  webp: "image",
  xls: "spreadsheet",
  xlsx: "xlsx",
  xml: "xml",
  zip: "zip",
}

/** The mark for a file, by media type then extension; 'file' when neither is known. */
export function resolveFileIconKey(
  mimeType: string | null | undefined,
  filename?: string | null,
): FileIconKey {
  // A deck is stored as JSON; its extension says what it is.
  if (/\.slides$/i.test(filename ?? "")) return "slides"

  const normalized = (mimeType ?? "").toLowerCase().split(";")[0]?.trim() ?? ""
  const exact = MIME_TO_ICON[normalized]

  if (exact) return exact

  if (normalized.startsWith("image/")) return "image"

  if (normalized.startsWith("audio/")) return "audio"

  if (normalized.startsWith("video/")) return "video"

  const base = filename?.split("/").pop() ?? ""
  const dot = base.lastIndexOf(".")
  const byExtension = dot > 0 ? EXT_TO_ICON[base.slice(dot + 1).toLowerCase()] : undefined

  return byExtension ?? "file"
}

/** Draws a file's coloured mark from its media type and name. */
export const FileIcon = ({
  mimeType,
  name,
  size = 16,
  ...props
}: TFileIconProps & { mimeType?: string | null; name?: string | null }) => {
  const key = isMarkdown(mimeType, name) ? "markdown" : resolveFileIconKey(mimeType, name)
  const mark = BRAND_MARKS[key]

  if (mark) {
    // Plain px sizes: Panda would read width={14} as its spacing token, not 14 pixels.
    const box = {
      width: size,
      height: size,
      flexShrink: 0,
      objectFit: "contain" as const,
      ...props.style,
    }

    return (
      <>
        <styled.img
          src={mark.light}
          alt=""
          aria-hidden
          style={box}
          display={mark.dark ? { base: "inline-block", _dark: "none" } : "inline-block"}
          data-file-mark=""
        />
        {mark.dark && (
          <styled.img
            src={mark.dark}
            alt=""
            aria-hidden
            style={box}
            display={{ base: "none", _dark: "inline-block" }}
            data-file-mark=""
          />
        )}
      </>
    )
  }

  const Icon = FileIcons[key === "markdown" ? "txt" : key]

  return <Icon size={size} aria-hidden {...props} />
}

function isMarkdown(mimeType: string | null | undefined, name: string | null | undefined) {
  if ((mimeType ?? "").toLowerCase().startsWith("text/markdown")) return true

  return /\.(md|markdown)$/i.test(name ?? "")
}
