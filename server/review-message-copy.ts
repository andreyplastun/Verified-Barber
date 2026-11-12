/** Also cleans legacy messages already waiting in the queue, without resending history. */
export function simplifyAnonymousReviewCopy(text: string): string {
  return text
    .replace(/можно анонимно, мастер не узнает, кто оценил/gi, "Можно анонимно")
    .replace(/можно анонимно — имя не показывается/gi, "Можно анонимно")
    .replace(/можно анонимно — мастер не узнает, от кого оценка/gi, "Можно анонимно")
    .replace(/можно анонимно, ваше имя мастеру не покажем/gi, "Можно анонимно")
    .replace(/Мастер не узнает, кто оценил/g, "Можно анонимно");
}
