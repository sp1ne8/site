# Структура frontend

`client/index.html` — это точка входа приложения. В нём намеренно мало разметки: контейнер `#app`, базовые meta-теги и подключение JavaScript-модуля.

```html
<div id="app">Загрузка...</div>
<script type="module" src="/src/main.js"></script>