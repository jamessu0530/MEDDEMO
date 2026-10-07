import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // shadcn 產生的元件慣例是把樣式函式（buttonVariants 等）跟元件一起匯出；
  // 這些檔案手改會在下次 shadcn add 覆寫時被蓋掉，所以只對這個資料夾關掉這條規則
  {
    files: ['src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // 座騎的縣市檔（components/rides/vehicles/<縣市>.tsx）只匯出四種座騎組成的 CityVehicles 物件，元件留在檔內；
  // 改圖時 Fast Refresh 往上交給 ride.tsx 重畫就好，所以這個資料夾關掉這條規則
  {
    files: ['src/components/rides/vehicles/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
