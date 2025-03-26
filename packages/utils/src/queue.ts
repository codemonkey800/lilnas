interface Node<T> {
  value: T
  prev?: Node<T> | undefined
  next?: Node<T> | undefined
}

export class Queue<T> {
  private head: Node<T> | undefined
  private tail: Node<T> | undefined
  private _size = 0

  push(value: T): void {
    const node: Node<T> = {
      value,
      prev: this.tail,
    }

    if (this.tail) {
      this.tail.next = node
    }

    this.tail = node

    if (!this.head) {
      this.head = this.tail
    }

    this._size++
  }

  pop(): T | undefined {
    if (!this.head) {
      return undefined
    }

    const value = this.head.value

    if (this.head.next) {
      this.head = this.head.next
      this.head.prev = undefined
      this._size--
    } else {
      this.clear()
    }

    return value
  }

  delete(value: T) {
    let node = this.head

    while (node && node.value !== value) {
      node = node.next
    }

    if (!node) {
      return
    }

    if (this.head && node === this.head) {
      this.head = this.head.next

      if (!this.head) {
        this.clear()
      } else {
        this.head.prev = undefined
      }
    } else if (this.tail && node === this.tail) {
      this.tail = this.tail.prev

      if (this.tail?.next) {
        this.tail.next = undefined
      }
    } else {
      if (node.prev) {
        node.prev.next = node.next
      }

      if (node.next) {
        node.next.prev = node.prev
      }
    }

    this._size--
  }

  size(): number {
    return this._size
  }

  isEmpty(): boolean {
    return this._size === 0
  }

  clear(): void {
    this.head = undefined
    this.tail = undefined
    this._size = 0
  }

  toJSON(): T[] {
    const result: T[] = []
    let node = this.head

    while (node) {
      result.push(node.value)
      node = node.next
    }

    return result
  }
}
