import { MousePointerClick } from 'lucide-react'
import { EmptyState } from '../../shared/ui/EmptyState'

export function InspectorPage() {
  return (
    <EmptyState icon={MousePointerClick} title="Nothing selected">
      Select an element in the Elements view to inspect its attributes, locators and uniqueness checks.
    </EmptyState>
  )
}
