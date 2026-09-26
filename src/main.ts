import { createApp } from 'vue';
import App from './App.vue';
import { lang, setLang } from './i18n';
import './style.css';

// 첫 화면(설정을 받기 전)은 브라우저 언어. <html lang>도 맞춰 한자·가나가 그 언어의 글꼴로 나오게 한다 (v1.13)
setLang(lang.value);

createApp(App).mount('#app');
